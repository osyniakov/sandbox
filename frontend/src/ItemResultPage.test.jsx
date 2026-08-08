import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ItemResultPage from './ItemResultPage.jsx'
import { AuthProvider } from './AuthContext.jsx'
import { API_BASE_URL } from './api.js'

// Mirrors the module-private constants in ItemResultPage.jsx (not exported,
// so duplicated here deliberately -- see that file's comments for why these
// specific values were chosen). If those constants ever change, these must
// be updated to match or the fake-timer tests below will drift out of sync
// with the real polling behavior.
const POLL_INTERVAL_MS = 2500
const MAX_POLL_MS = 2 * 60 * 1000

// Fixture Item records, one per backend `Decision` value plus one
// still-processing (non-terminal `status`) case -- matching the shape
// `_serialize_item` in backend/app/main.py actually returns.
const SELL_ITEM = {
  id: 1,
  photo_path: '/x/uploads/a.jpg',
  photo_url: '/uploads/a.jpg',
  identified_name: 'Cordless Drill',
  category: 'Power Tools',
  brand: 'Bosch',
  condition: 'good',
  hint: null,
  search_keywords: ['bosch', 'drill'],
  suggested_price: 45.5,
  suggested_title: null,
  suggested_description: null,
  decision: 'sell',
  status: 'decided',
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:05:00+00:00',
  comparable_listings: [
    {
      id: 10,
      title: 'Bosch cordless drill, good condition',
      price: 45,
      url: 'https://kleinanzeigen.example/1',
      condition: 'good',
      location: 'Berlin',
    },
    {
      id: 11,
      title: 'Bosch drill set',
      price: 46,
      url: 'https://kleinanzeigen.example/2',
      condition: 'good',
      location: 'Munich',
    },
  ],
}

const GIVE_AWAY_ITEM = {
  ...SELL_ITEM,
  id: 2,
  identified_name: 'Old Board Game',
  category: 'Toys & Games',
  suggested_price: 3,
  decision: 'give_away',
  comparable_listings: [
    {
      id: 20,
      title: 'Used board game',
      price: 3,
      url: 'https://kleinanzeigen.example/3',
      condition: 'used',
      location: 'Hamburg',
    },
  ],
}

// Suggested-title/description variants (sandbox-dwl.5) -- one per decision
// that actually generates them (sell, give_away). `_serialize_item` always
// includes these two keys (string or null), and the pipeline only ever
// populates them for these two decisions (throw_away/pending stay null;
// see backend/app/pipeline.py), so PROCESSING_ITEM/THROW_AWAY_ITEM below
// deliberately keep them null via the SELL_ITEM spread rather than getting
// their own overrides.
const SELL_ITEM_WITH_SUGGESTION = {
  ...SELL_ITEM,
  suggested_title: 'Bosch Cordless Drill – Good Condition',
  suggested_description: 'Well-maintained Bosch cordless drill.\nComes with charger and case.',
}

const GIVE_AWAY_ITEM_WITH_SUGGESTION = {
  ...GIVE_AWAY_ITEM,
  suggested_title: 'Old Board Game – Free to a Good Home',
  suggested_description: 'Complete board game, all pieces included.\nFree, just come pick it up.',
}

const THROW_AWAY_ITEM = {
  ...SELL_ITEM,
  id: 3,
  identified_name: 'Broken Lamp',
  category: 'Lighting',
  condition: 'broken',
  suggested_price: null,
  decision: 'throw_away',
  comparable_listings: [],
}

const PROCESSING_ITEM = {
  id: 4,
  photo_path: '/x/uploads/d.jpg',
  photo_url: '/uploads/d.jpg',
  identified_name: null,
  category: null,
  brand: null,
  condition: null,
  hint: null,
  search_keywords: null,
  suggested_price: null,
  decision: 'pending',
  status: 'pending_identification',
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:00:00+00:00',
  comparable_listings: [],
}

// Wrapped in AuthProvider (sandbox-dfr.5) since ItemResultPage now renders
// SignOutControl (reads useAuth()) and fetches its photo via
// useAuthedImageUrl (reads apiFetch, which reads localStorage directly, not
// AuthContext). No token is ever stored in these tests, so AuthProvider's
// mount check settles synchronously to unauthenticated/no-email WITHOUT
// calling `fetch` itself (see AuthContext.jsx) -- this keeps every existing
// `fetch`-call-count assertion below accurate.
function renderAtItem(id) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/items/${id}`]}>
        <Routes>
          <Route path="/items/:id" element={<ItemResultPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

// Advances Vitest's fake clock by `ms` and, within an `act`, lets any
// promises that settle along the way (e.g. the mocked `fetch` -> `.json()`
// chain triggered by a poll tick) resolve and their resulting state
// updates flush. `waitFor` is deliberately NOT used for this: its
// fake-timer detection (@testing-library/dom's `jestFakeTimersAreEnabled`)
// only recognizes Jest's fake timers, not Vitest's, so under
// `vi.useFakeTimers()` it would poll via the (now-fake, non-advancing)
// global `setTimeout` and hang instead of ever seeing the update.
async function advanceAndFlush(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// Mocks `fetch` to route `GET /items/:id` (or any poll thereof) to
// `itemResponse`/`item` and `GET /uploads/...` (the authenticated photo
// fetch `useAuthedImageUrl` makes via apiFetch, sandbox-dfr.5) to a
// separate, distinguishable response -- a single blanket
// `fetch.mockResolvedValue` can't tell those two request kinds apart, and
// the item-shaped response has no `.blob()` method the photo hook needs.
function mockItemAndPhotoFetch(item, { photoOk = true } = {}) {
  fetch.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/uploads/')) {
      if (!photoOk) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => item })
  })
}

// Like mockItemAndPhotoFetch, but for the polling tests below: each
// successive `GET /items/:id` call returns the next entry in
// `itemSequence` (clamped to the last entry once exhausted), while `GET
// /uploads/...` calls (the photo fetch every poll re-triggers whenever
// `photo_url` changes, sandbox-dfr.5) are routed separately -- keeps the
// two request kinds from consuming a single shared call queue out of
// order, since ItemResultPage now fires both per poll.
function mockPollingItemAndPhoto(itemSequence) {
  let itemCallIndex = 0
  fetch.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/uploads/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
      })
    }
    const item = itemSequence[Math.min(itemCallIndex, itemSequence.length - 1)]
    itemCallIndex += 1
    return Promise.resolve({ ok: true, status: 200, json: async () => item })
  })
}

// Counts only the `GET /items/:id` polling calls, excluding the separate
// `GET /uploads/...` authenticated photo fetches (sandbox-dfr.5) that now
// also flow through the same mocked `fetch`.
function itemFetchCallCount() {
  return fetch.mock.calls.filter(([url]) => typeof url === 'string' && !url.includes('/uploads/'))
    .length
}

describe('ItemResultPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    // Defensive: if a fake-timer test throws before reaching its own
    // `vi.useRealTimers()`, this still restores real timers for every
    // subsequent test rather than letting the leak cascade.
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('renders the sell decision with suggested price and comparable listings', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    expect(screen.getByText(/sell/i)).toBeInTheDocument()
    expect(screen.getByText(/45\.50/)).toBeInTheDocument()

    const links = screen.getAllByRole('link', { name: /bosch/i })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://kleinanzeigen.example/1')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')

    // Each comparable listing renders its own price/condition/location as
    // text, not just a link -- assert against each <li>'s full text content
    // (rather than a page-wide screen.getByText, which would be ambiguous
    // once more than one listing is present) so a regression that dropped
    // or mismatched a listing's price/condition/location would be caught
    // even though the link/href assertions above would still pass.
    const listItems = screen.getAllByRole('listitem')
    expect(listItems).toHaveLength(2)
    expect(listItems[0]).toHaveTextContent(
      'Bosch cordless drill, good condition — 45.00 EUR, good, Berlin',
    )
    expect(listItems[1]).toHaveTextContent('Bosch drill set — 46.00 EUR, good, Munich')
  })

  it('renders the give_away decision with comparable listings but no suggested price', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => GIVE_AWAY_ITEM })

    renderAtItem(2)

    await waitFor(() => {
      expect(screen.getByText(/old board game/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/give away/i)).toBeInTheDocument()
    // suggested_price is only shown for decision === 'sell'.
    expect(screen.queryByText(/suggested price/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /used board game/i })).toHaveAttribute(
      'href',
      'https://kleinanzeigen.example/3',
    )
  })

  // jsdom does not implement `navigator.clipboard` by default -- stubbed
  // per-test (rather than globally in setupTests.js) since only the copy
  // tests below need it, keeping every other test's `navigator` untouched.
  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })
    return writeText
  }

  it('shows the suggested title/description with copy-to-clipboard for a sell decision', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM_WITH_SUGGESTION })
    const writeText = stubClipboard()

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByText(SELL_ITEM_WITH_SUGGESTION.suggested_title)).toBeInTheDocument()
    })
    expect(
      screen.getByText(/well-maintained bosch cordless drill/i),
    ).toBeInTheDocument()

    const copyTitleButton = screen.getByRole('button', { name: /copy title/i })
    fireEvent.click(copyTitleButton)
    expect(writeText).toHaveBeenCalledWith(SELL_ITEM_WITH_SUGGESTION.suggested_title)
    await waitFor(() => {
      expect(copyTitleButton).toHaveTextContent('Copied!')
    })

    const copyDescriptionButton = screen.getByRole('button', { name: /copy description/i })
    fireEvent.click(copyDescriptionButton)
    expect(writeText).toHaveBeenCalledWith(SELL_ITEM_WITH_SUGGESTION.suggested_description)
    await waitFor(() => {
      expect(copyDescriptionButton).toHaveTextContent('Copied!')
    })
  })

  it('shows the suggested title/description with copy-to-clipboard for a give_away decision', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => GIVE_AWAY_ITEM_WITH_SUGGESTION,
    })
    const writeText = stubClipboard()

    renderAtItem(2)

    await waitFor(() => {
      expect(
        screen.getByText(GIVE_AWAY_ITEM_WITH_SUGGESTION.suggested_title),
      ).toBeInTheDocument()
    })
    expect(screen.getByText(/complete board game, all pieces included/i)).toBeInTheDocument()

    const copyTitleButton = screen.getByRole('button', { name: /copy title/i })
    fireEvent.click(copyTitleButton)
    expect(writeText).toHaveBeenCalledWith(GIVE_AWAY_ITEM_WITH_SUGGESTION.suggested_title)
    await waitFor(() => {
      expect(copyTitleButton).toHaveTextContent('Copied!')
    })

    const copyDescriptionButton = screen.getByRole('button', { name: /copy description/i })
    fireEvent.click(copyDescriptionButton)
    expect(writeText).toHaveBeenCalledWith(GIVE_AWAY_ITEM_WITH_SUGGESTION.suggested_description)
    await waitFor(() => {
      expect(copyDescriptionButton).toHaveTextContent('Copied!')
    })
  })

  it('does not render the suggested listing section when suggested_title/suggested_description are null', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    expect(screen.queryByText(/suggested kleinanzeigen listing/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy title/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy description/i })).not.toBeInTheDocument()
  })

  it('renders the throw_away decision with no comparable listings and no suggested price', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => THROW_AWAY_ITEM })

    renderAtItem(3)

    await waitFor(() => {
      expect(screen.getByText(/broken lamp/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/throw away/i)).toBeInTheDocument()
    expect(screen.queryByText(/suggested price/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no comparable listings found/i)).toBeInTheDocument()
    // "Upload another photo" + "View basement inventory" nav links
    // (sandbox-yqf.11) -- no comparable-listing links since there are none.
    expect(screen.queryAllByRole('link')).toHaveLength(2)
  })

  it('shows a pending indicator (not broken/missing fields) while status is non-terminal', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => PROCESSING_ITEM })

    renderAtItem(4)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/still working on this item/i)
    })

    // None of the decided-only fields should render while pending.
    expect(screen.queryByText(/suggested price/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/comparable listings/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sell|give away|throw away/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
  })

  it('renders the photo via an authenticated blob-URL fetch, not a raw unauthenticated <img src>', async () => {
    mockItemAndPhotoFetch(SELL_ITEM)

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    // The photo bytes are fetched via apiFetch against the relative
    // photo_url (sandbox-dfr.5) -- GET /uploads/{filename} now requires an
    // Authorization header a plain <img src> can't send.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}${SELL_ITEM.photo_url}`,
        expect.anything(),
      )
    })

    const img = await screen.findByRole('img')
    await waitFor(() => {
      expect(img).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    })
    expect(screen.queryByTestId('photo-placeholder')).not.toBeInTheDocument()
  })

  it('shows a placeholder (never a broken-image icon) while the authenticated photo fetch is still in flight', async () => {
    let resolvePhotoFetch
    const photoPromise = new Promise((resolve) => {
      resolvePhotoFetch = resolve
    })
    fetch.mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/uploads/')) {
        return photoPromise
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => SELL_ITEM })
    })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    // The photo fetch is still pending -- no <img> yet, just a placeholder.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()

    resolvePhotoFetch({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
    })

    await waitFor(() => {
      expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    })
  })

  it('keeps showing a placeholder (not a broken-image icon) when the authenticated photo fetch fails', async () => {
    mockItemAndPhotoFetch(SELL_ITEM, { photoOk: false })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows a session-expired message (not a raw error) when the item fetch itself gets a 401', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Not authenticated' }),
    })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    })
    expect(screen.queryByText(/not authenticated/i)).not.toBeInTheDocument()
  })

  it('renders a reachable sign-out control once the item has loaded', async () => {
    mockItemAndPhotoFetch(SELL_ITEM)

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows the user-provided hint when present', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...SELL_ITEM, hint: 'some brand, I think' }),
    })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    expect(screen.getByText(/your hint: some brand, i think/i)).toBeInTheDocument()
  })

  it('does not render a hint line when hint is null', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    expect(screen.queryByText(/your hint/i)).not.toBeInTheDocument()
  })

  it('shows an error state when the item does not exist (404)', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ detail: 'No item with id 999.' }),
    })

    renderAtItem(999)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no item with id 999/i)
    })
  })

  it('polls repeatedly while status is non-terminal, and stops immediately once status becomes terminal', async () => {
    vi.useFakeTimers()

    mockPollingItemAndPhoto([PROCESSING_ITEM, PROCESSING_ITEM, SELL_ITEM])

    renderAtItem(4)

    // The first fetch fires synchronously on mount, before any timer tick.
    await advanceAndFlush(0)
    expect(itemFetchCallCount()).toBe(1)

    // Still non-terminal (PROCESSING_ITEM) after one poll interval --
    // polling must continue.
    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(itemFetchCallCount()).toBe(2)

    // The third response flips to a terminal status (SELL_ITEM/"decided").
    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(itemFetchCallCount()).toBe(3)
    expect(screen.getByText(/sell/i)).toBeInTheDocument()

    // Advancing well past several more poll intervals must NOT trigger any
    // further fetches now that the item is terminal.
    await advanceAndFlush(POLL_INTERVAL_MS * 5)
    expect(itemFetchCallCount()).toBe(3)

    vi.useRealTimers()
  })

  it('stops fetching once the component unmounts', async () => {
    vi.useFakeTimers()

    mockPollingItemAndPhoto([PROCESSING_ITEM])

    const { unmount } = renderAtItem(4)

    await advanceAndFlush(0)
    expect(itemFetchCallCount()).toBe(1)

    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(itemFetchCallCount()).toBe(2)

    unmount()

    // No further fetches after unmount, no matter how long we wait.
    await advanceAndFlush(POLL_INTERVAL_MS * 10)
    expect(itemFetchCallCount()).toBe(2)

    vi.useRealTimers()
  })

  it('shows a "taking longer than expected" message once MAX_POLL_MS elapses while still non-terminal', async () => {
    vi.useFakeTimers()

    mockPollingItemAndPhoto([PROCESSING_ITEM])

    renderAtItem(4)

    await advanceAndFlush(0)
    expect(screen.queryByText(/taking longer than expected/i)).not.toBeInTheDocument()

    // Just before the MAX_POLL_MS cutoff: not stuck yet.
    await advanceAndFlush(MAX_POLL_MS - POLL_INTERVAL_MS)
    expect(screen.queryByText(/taking longer than expected/i)).not.toBeInTheDocument()

    // One more poll interval crosses the MAX_POLL_MS threshold.
    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument()

    vi.useRealTimers()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InventoryPage from './InventoryPage.jsx'
import { AuthProvider } from './AuthContext.jsx'
import { API_BASE_URL } from './api.js'

// Fixture Item records matching the shape `_serialize_item` in
// backend/app/main.py returns (same convention as ItemResultPage.test.jsx).
const DECIDED_SELL_ITEM = {
  id: 1,
  photo_path: '/x/uploads/a.jpg',
  photo_url: '/uploads/a.jpg',
  identified_name: 'Cordless Drill',
  category: 'Power Tools',
  brand: 'Bosch',
  condition: 'good',
  search_keywords: ['bosch', 'drill'],
  suggested_price: 45.5,
  decision: 'sell',
  status: 'decided',
  // Matches MANUAL_STATUS_TRANSITIONS['decided'] in backend/app/main.py,
  // sorted the same way `_serialize_item` sorts it server-side.
  valid_next_statuses: ['disposed', 'given_away', 'listed'],
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:05:00+00:00',
  comparable_listings: [],
}

const LISTED_ITEM = {
  ...DECIDED_SELL_ITEM,
  id: 2,
  identified_name: 'Old Bookshelf',
  status: 'listed',
  // Matches MANUAL_STATUS_TRANSITIONS['listed'] in backend/app/main.py.
  valid_next_statuses: ['disposed', 'given_away'],
}

const PENDING_ITEM = {
  id: 3,
  photo_path: '/x/uploads/c.jpg',
  photo_url: '/uploads/c.jpg',
  identified_name: null,
  category: null,
  brand: null,
  condition: null,
  search_keywords: null,
  suggested_price: null,
  decision: 'pending',
  status: 'pending_identification',
  // Matches MANUAL_STATUS_TRANSITIONS['pending_identification'] (empty).
  valid_next_statuses: [],
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:00:00+00:00',
  comparable_listings: [],
}

// Wrapped in AuthProvider (sandbox-dfr.5) since InventoryPage now renders
// SignOutControl (reads useAuth()) and fetches each photo thumbnail via
// useAuthedImageUrl. No token is ever stored in these tests, so
// AuthProvider's mount check settles synchronously to
// unauthenticated/no-email WITHOUT calling `fetch` itself (see
// AuthContext.jsx) -- this keeps every existing `fetch`-call assertion
// below accurate.
function renderInventoryPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/inventory']}>
        <Routes>
          <Route path="/inventory" element={<InventoryPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

// Mocks `fetch` so `GET /items...` (list) and `PATCH /items/:id/status`
// resolve via `itemsHandler`/`patchHandler`, while `GET /uploads/...` (each
// item's authenticated photo thumbnail fetch, sandbox-dfr.5) resolves to a
// fake Blob response -- a blanket mock can't tell these apart, and the
// items-shaped response has no `.blob()` method the photo hook needs.
function mockInventoryFetch({ itemsHandler, patchHandler }) {
  fetch.mockImplementation((url, options = {}) => {
    if (typeof url === 'string' && url.includes('/uploads/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
      })
    }
    if (options.method === 'PATCH') {
      return patchHandler(url, options)
    }
    return itemsHandler(url, options)
  })
}

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('fetches and renders all items with photo, decision, and status', async () => {
    mockInventoryFetch({
      itemsHandler: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [DECIDED_SELL_ITEM, LISTED_ITEM, PENDING_ITEM],
        }),
      patchHandler: () => Promise.reject(new Error('unexpected PATCH call')),
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/items`, expect.anything())
    expect(screen.getByText(/old bookshelf/i)).toBeInTheDocument()
    expect(screen.getByText(/item #3/i)).toBeInTheDocument()

    // Each photo thumbnail is fetched authenticated (sandbox-dfr.5) and
    // rendered as a `blob:` object URL, not a raw unauthenticated
    // `${API_BASE_URL}${photo_url}` <img src> -- GET /uploads/{filename}
    // now requires an Authorization header a plain <img src> can't send.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/uploads/a.jpg`, expect.anything())
    })

    await waitFor(() => {
      const images = screen.getAllByRole('img')
      expect(images.some((img) => (img.getAttribute('src') || '').startsWith('blob:'))).toBe(true)
    })
  })

  it('shows the low-confidence badge only for items with decision_confidence "low"', async () => {
    mockInventoryFetch({
      itemsHandler: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { ...DECIDED_SELL_ITEM, decision_confidence: 'low' },
            { ...LISTED_ITEM, decision_confidence: 'high' },
            { ...PENDING_ITEM, decision_confidence: null },
          ],
        }),
      patchHandler: () => Promise.reject(new Error('unexpected PATCH call')),
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    expect(
      screen.getByText(/few comparable listings — double-check the price/i),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/double-check/i)).toHaveLength(1)
  })

  it('shows the zero-comparable low-confidence text for a low-confidence throw_away item', async () => {
    mockInventoryFetch({
      itemsHandler: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              ...DECIDED_SELL_ITEM,
              decision: 'throw_away',
              decision_confidence: 'low',
              comparable_listings: [],
            },
          ],
        }),
      patchHandler: () => Promise.reject(new Error('unexpected PATCH call')),
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    expect(
      screen.getByText(/no comparable listings found — double-check/i),
    ).toBeInTheDocument()
  })

  it('shows a per-item placeholder (not a broken-image icon) while an authenticated photo fetch is pending, then renders it', async () => {
    let resolvePhotoFetch
    const photoPromise = new Promise((resolve) => {
      resolvePhotoFetch = resolve
    })
    fetch.mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/uploads/')) {
        return photoPromise
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [DECIDED_SELL_ITEM] })
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    resolvePhotoFetch({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
    })

    await waitFor(() => {
      expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    })
  })

  it('fetches once without query params and filters in memory via tiles and chips', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [DECIDED_SELL_ITEM, LISTED_ITEM, PENDING_ITEM],
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })
    const itemCalls = () => fetch.mock.calls.filter(([url]) => !String(url).includes('/uploads/'))
    expect(itemCalls()).toHaveLength(1)

    // Tile counts cover every item, whatever the status filter.
    const sellTile = screen.getByRole('button', { name: /^sell\s*2$/i })
    expect(sellTile).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^pending\s*1$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Listed' }))
    expect(screen.queryByText(/cordless drill/i)).not.toBeInTheDocument()
    expect(screen.getByText(/old bookshelf/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Listed' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^sell\s*2$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^pending\s*1$/i }))
    expect(screen.getByText(/no items match these filters/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    expect(screen.getByText(/item #3/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^sell\s*2$/i }))
    expect(screen.getByRole('button', { name: /^sell\s*2$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText(/item #3/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^sell\s*2$/i }))
    expect(screen.getByText(/item #3/i)).toBeInTheDocument()

    expect(itemCalls()).toHaveLength(1)
  })

  it('shows the summary line, omitting the sell value when it is zero', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [DECIDED_SELL_ITEM, LISTED_ITEM, PENDING_ITEM],
    })
    renderInventoryPage()
    // 45.5 + 45.5 = 91 -> whole euros.
    expect(await screen.findByText(/3 items · 1 waiting on you · ~€91 to sell/)).toBeInTheDocument()
    cleanup()

    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [PENDING_ITEM] })
    renderInventoryPage()
    expect(await screen.findByText(/^1 item · 0 waiting on you$/)).toBeInTheDocument()
  })

  it('offers chips for failure statuses and shows friendly labels', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { ...PENDING_ITEM, id: 5, status: 'identification_failed' },
        { ...PENDING_ITEM, id: 6, status: 'search_failed' },
      ],
    })
    renderInventoryPage()
    await screen.findByText(/item #5/i)
    expect(screen.getByText('Status: Couldn\'t identify')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Search failed' }))
    expect(screen.queryByText(/item #5/i)).not.toBeInTheDocument()
    expect(screen.getByText(/item #6/i)).toBeInTheDocument()
  })

  it('keeps counts correct and drops the item from a filtered view after a status change', async () => {
    const user = userEvent.setup()
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ...DECIDED_SELL_ITEM, status: 'listed', valid_next_statuses: [] }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [DECIDED_SELL_ITEM] })
    })
    renderInventoryPage()
    await screen.findByText(/cordless drill/i)
    await user.click(screen.getByRole('button', { name: 'To do' }))
    await user.click(screen.getByRole('button', { name: /mark as listed on kleinanzeigen/i }))
    await waitFor(() => {
      expect(screen.queryByText(/cordless drill/i)).not.toBeInTheDocument()
    })
    expect(screen.getByText(/no items match these filters/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^sell\s*1$/i })).toBeInTheDocument()
  })

  it('shows the "Nothing here yet" state with an Add item link when there are no items', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    renderInventoryPage()
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /add item/i })
    links.forEach((link) => expect(link).toHaveAttribute('href', '/'))
    expect(screen.queryByText(/no items match/i)).not.toBeInTheDocument()
  })

  it('shows a status-advance button only for currently-valid next states, and calls PATCH with the right payload', async () => {
    const user = userEvent.setup()
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            ...DECIDED_SELL_ITEM,
            status: 'listed',
            valid_next_statuses: ['disposed', 'given_away'],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [DECIDED_SELL_ITEM],
      })
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    // decided -> listed, given_away, disposed are all valid.
    expect(
      screen.getByRole('button', { name: /mark as listed on kleinanzeigen/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark as given away/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark as disposed/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /mark as listed on kleinanzeigen/i }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/items/1/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'listed' }),
        }),
      )
    })
  })

  it('does not render any status-advance buttons for a pending (non-decided) item', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [PENDING_ITEM] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/item #3/i)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /mark as/i })).not.toBeInTheDocument()
  })

  it('renders exactly two status-advance buttons for a listed item (given_away, disposed)', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [LISTED_ITEM] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/old bookshelf/i)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /mark as given away/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark as disposed/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /mark as listed on kleinanzeigen/i }),
    ).not.toBeInTheDocument()
  })

  it('renders buttons driven solely by the API-provided valid_next_statuses field, not any client-side rule derived from status', async () => {
    // A 'listed' item wouldn't normally have 'listed' as one of its own
    // valid next statuses per the backend's real MANUAL_STATUS_TRANSITIONS
    // table -- but this test's whole point is to prove the frontend has
    // NO independent opinion about that and just renders whatever
    // `valid_next_statuses` the API response says, so we pick a
    // deliberately atypical value here.
    const oddItem = {
      ...LISTED_ITEM,
      id: 4,
      identified_name: 'Odd Item',
      valid_next_statuses: ['listed'],
    }
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [oddItem] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/odd item/i)).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /mark as listed on kleinanzeigen/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark as given away/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark as disposed/i })).not.toBeInTheDocument()
  })

  it('shows an error message when the PATCH request fails', async () => {
    const user = userEvent.setup()
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            detail:
              "Cannot transition item 1 from status 'decided' to 'listed'. " +
              "Current status: 'decided'. Valid next states: disposed, given_away, listed.",
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [DECIDED_SELL_ITEM],
      })
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /mark as listed on kleinanzeigen/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cannot transition item 1/i)
    })
  })

  it('shows an error state when the initial list fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('shows a session-expired message (not a raw error) when the list fetch gets a 401', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Not authenticated' }),
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    })
    expect(screen.queryByText(/not authenticated/i)).not.toBeInTheDocument()
  })

  it('shows a session-expired message (not a raw error) when a PATCH status-advance gets a 401', async () => {
    const user = userEvent.setup()
    mockInventoryFetch({
      itemsHandler: () =>
        Promise.resolve({ ok: true, status: 200, json: async () => [DECIDED_SELL_ITEM] }),
      patchHandler: () =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ detail: 'Not authenticated' }),
        }),
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /mark as listed on kleinanzeigen/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    })
    expect(screen.queryByText(/not authenticated/i)).not.toBeInTheDocument()
  })

  it('deletes an item and removes it from the list after confirming', async () => {
    const user = userEvent.setup()
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, deleted: true }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [DECIDED_SELL_ITEM],
      })
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))


    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/items/1`,
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText(/cordless drill/i)).not.toBeInTheDocument()
    })
  })

  it('does not delete or call the endpoint when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [DECIDED_SELL_ITEM] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Delete this item?')
    expect(within(dialog).getByText(/“Cordless Drill” and its photo will be removed for good\./)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^cancel$/i })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toHaveFocus()

    expect(fetch).not.toHaveBeenCalledWith(
      `${API_BASE_URL}/items/1`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
  })

  it('shows an error and leaves the item in place when the delete request fails', async () => {
    const user = userEvent.setup()
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ detail: 'No item with id 1.' }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [DECIDED_SELL_ITEM],
      })
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no item with id 1/i)
    })
    expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
  })

  it('disables the delete button for an item while its delete is in flight', async () => {
    const user = userEvent.setup()
    let resolveDelete
    const deletePromise = new Promise((resolve) => {
      resolveDelete = resolve
    })
    fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'DELETE') {
        return deletePromise
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [DECIDED_SELL_ITEM],
      })
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    const deleteButton = screen.getByRole('button', { name: /^delete$/i })
    await user.click(deleteButton)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled()
    })

    resolveDelete({ ok: true, status: 200, json: async () => ({ id: 1, deleted: true }) })

    await waitFor(() => {
      expect(screen.queryByText(/cordless drill/i)).not.toBeInTheDocument()
    })
  })

  it('closes the delete dialog on Escape without deleting and restores focus', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [DECIDED_SELL_ITEM] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    const trigger = screen.getByRole('button', { name: /^delete$/i })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(fetch).not.toHaveBeenCalledWith(
      `${API_BASE_URL}/items/1`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

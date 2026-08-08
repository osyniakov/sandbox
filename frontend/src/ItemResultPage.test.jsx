import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ItemResultPage from './ItemResultPage.jsx'
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
  search_keywords: ['bosch', 'drill'],
  suggested_price: 45.5,
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
  search_keywords: null,
  suggested_price: null,
  decision: 'pending',
  status: 'pending_identification',
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:00:00+00:00',
  comparable_listings: [],
}

function renderAtItem(id) {
  return render(
    <MemoryRouter initialEntries={[`/items/${id}`]}>
      <Routes>
        <Route path="/items/:id" element={<ItemResultPage />} />
      </Routes>
    </MemoryRouter>,
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

describe('ItemResultPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    // Defensive: if a fake-timer test throws before reaching its own
    // `vi.useRealTimers()`, this still restores real timers for every
    // subsequent test rather than letting the leak cascade.
    vi.useRealTimers()
    vi.unstubAllGlobals()
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

  it('renders an <img> pointing at photo_url resolved against API_BASE_URL', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', `${API_BASE_URL}${SELL_ITEM.photo_url}`)
    expect(screen.queryByTestId('photo-placeholder')).not.toBeInTheDocument()
  })

  it('falls back to a "photo unavailable" message when the image fails to load', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(1)

    const img = await screen.findByRole('img')
    fireEvent.error(img)

    await waitFor(() => {
      expect(screen.getByTestId('photo-placeholder')).toHaveTextContent(/photo unavailable/i)
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
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

    fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => PROCESSING_ITEM })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => PROCESSING_ITEM })
      .mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(4)

    // The first fetch fires synchronously on mount, before any timer tick.
    await advanceAndFlush(0)
    expect(fetch).toHaveBeenCalledTimes(1)

    // Still non-terminal (PROCESSING_ITEM) after one poll interval --
    // polling must continue.
    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(fetch).toHaveBeenCalledTimes(2)

    // The third response flips to a terminal status (SELL_ITEM/"decided").
    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(screen.getByText(/sell/i)).toBeInTheDocument()

    // Advancing well past several more poll intervals must NOT trigger any
    // further fetches now that the item is terminal.
    await advanceAndFlush(POLL_INTERVAL_MS * 5)
    expect(fetch).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
  })

  it('stops fetching once the component unmounts', async () => {
    vi.useFakeTimers()

    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => PROCESSING_ITEM })

    const { unmount } = renderAtItem(4)

    await advanceAndFlush(0)
    expect(fetch).toHaveBeenCalledTimes(1)

    await advanceAndFlush(POLL_INTERVAL_MS)
    expect(fetch).toHaveBeenCalledTimes(2)

    unmount()

    // No further fetches after unmount, no matter how long we wait.
    await advanceAndFlush(POLL_INTERVAL_MS * 10)
    expect(fetch).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('shows a "taking longer than expected" message once MAX_POLL_MS elapses while still non-terminal', async () => {
    vi.useFakeTimers()

    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => PROCESSING_ITEM })

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

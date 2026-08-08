import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InventoryPage from './InventoryPage.jsx'
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

function renderInventoryPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory']}>
      <Routes>
        <Route path="/inventory" element={<InventoryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('fetches and renders all items with photo, decision, and status', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [DECIDED_SELL_ITEM, LISTED_ITEM, PENDING_ITEM],
    })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/items`, expect.anything())
    expect(screen.getByText(/old bookshelf/i)).toBeInTheDocument()
    expect(screen.getByText(/item #3/i)).toBeInTheDocument()

    const images = screen.getAllByRole('img')
    expect(images.some((img) => img.getAttribute('src') === `${API_BASE_URL}/uploads/a.jpg`)).toBe(
      true,
    )
  })

  it('calls GET /items with status and decision query params when filters change', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] })

    renderInventoryPage()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/items`, expect.anything())
    })

    fetch.mockClear()
    await user.selectOptions(screen.getByLabelText(/^status$/i), 'decided')

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/items?status=decided`,
        expect.anything(),
      )
    })

    fetch.mockClear()
    await user.selectOptions(screen.getByLabelText(/^decision$/i), 'sell')

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/items?status=decided&decision=sell`,
        expect.anything(),
      )
    })
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
})

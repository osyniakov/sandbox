import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('renders a reachable sign-out control', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    })
  })

  it('deletes an item and removes it from the list after confirming', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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

    expect(window.confirm).toHaveBeenCalledWith('Delete this item? This cannot be undone.')

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
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [DECIDED_SELL_ITEM] })

    renderInventoryPage()

    await waitFor(() => {
      expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    expect(window.confirm).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalledWith(
      `${API_BASE_URL}/items/1`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
  })

  it('shows an error and leaves the item in place when the delete request fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no item with id 1/i)
    })
    expect(screen.getByText(/cordless drill/i)).toBeInTheDocument()
  })

  it('disables the delete button for an item while its delete is in flight', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled()
    })

    resolveDelete({ ok: true, status: 200, json: async () => ({ id: 1, deleted: true }) })

    await waitFor(() => {
      expect(screen.queryByText(/cordless drill/i)).not.toBeInTheDocument()
    })
  })
})

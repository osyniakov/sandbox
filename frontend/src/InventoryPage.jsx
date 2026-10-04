import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from './api.js'
import { formatPrice } from './format.js'
import { Plus } from './icons.jsx'
import { useAuthedImageUrl } from './useAuthedImageUrl.js'

const STATUS_ACTION_LABELS = {
  listed: 'Mark as listed on Kleinanzeigen',
  given_away: 'Mark as given away',
  disposed: 'Mark as disposed',
}

const STATUS_LABELS = {
  decided: 'To do',
  listed: 'Listed',
  given_away: 'Given away',
  disposed: 'Disposed',
  pending_identification: 'Pending identification',
  pending_search: 'Pending search',
  pending_decision: 'Pending decision',
  identification_failed: "Couldn't identify",
  search_failed: 'Search failed',
}

const DECISION_LABELS = {
  sell: 'Sell',
  give_away: 'Give away',
  throw_away: 'Throw away',
  pending: 'Pending',
}

const STATUS_FILTER_OPTIONS = Object.keys(STATUS_LABELS)
const DECISION_FILTER_OPTIONS = Object.keys(DECISION_LABELS)

// Pill classes for the decision tiles (same tokens as the prototype).
const DECISION_TILE_PILL_CLASSES = {
  sell: 'bg-sell-soft text-sell',
  give_away: 'bg-give-soft text-give',
  throw_away: 'bg-toss-soft text-toss',
  pending: 'bg-sunken text-muted',
}

// Maps each `Item.decision` value to the shared semantic decision-color
// tokens defined in index.css (sandbox-zlt.2's @theme block), so the
// badge below reuses the same sell=green / give_away=blue /
// throw_away=red / pending=neutral meaning as the rest of the app.
const DECISION_BADGE_CLASSES = {
  pending: 'bg-pending-bg text-pending-text border-pending-border',
  sell: 'bg-sell-bg text-sell-text border-sell-border',
  give_away: 'bg-give-away-bg text-give-away-text border-give-away-border',
  throw_away: 'bg-throw-away-bg text-throw-away-text border-throw-away-border',
}

// One unfiltered request: the decision tiles need counts for every decision
// regardless of the active filters, so filtering happens in memory.
async function fetchItems(signal) {
  const response = await apiFetch('/items', { signal })
  if (!response.ok) {
    // A 401 means the session expired while this page was open -- apiFetch
    // (api.js) has already cleared the stale token and dispatched
    // SESSION_EXPIRED_EVENT, which AuthContext listens for to flip the app
    // back to the sign-in gate on its next render. This still surfaces
    // through the same `loadError` state as any other load failure below,
    // just with a message that actually explains what happened.
    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign in again.')
    }
    throw new Error(`Failed to load items (${response.status} ${response.statusText})`)
  }
  return response.json()
}

async function patchItemStatus(id, status, signal) {
  const response = await apiFetch(`/items/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  })
  if (!response.ok) {
    // Same session-expired handling as fetchItems above.
    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign in again.')
    }
    let detail = `Failed to update status (${response.status} ${response.statusText})`
    try {
      const body = await response.json()
      if (body && typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // Body wasn't JSON -- fall back to the generic message above.
    }
    throw new Error(detail)
  }
  return response.json()
}

async function deleteItem(id, signal) {
  const response = await apiFetch(`/items/${id}`, {
    method: 'DELETE',
    signal,
  })
  if (!response.ok) {
    // Same session-expired handling as fetchItems/patchItemStatus above.
    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign in again.')
    }
    let detail = `Failed to delete item (${response.status} ${response.statusText})`
    try {
      const body = await response.json()
      if (body && typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // Body wasn't JSON -- fall back to the generic message above.
    }
    throw new Error(detail)
  }
  return response.json()
}

// Renders a single inventory item's photo thumbnail (or a "no photo"/
// loading placeholder), extracted into its own component because
// `useAuthedImageUrl` is a hook and hooks can't be called inside the
// `.map()` below (one call per rendered `<li>`, sandbox-dfr.5). Handles the
// same "no photo yet" / "still loading" / "ready" states ItemResultPage.jsx
// handles for its single photo -- see useAuthedImageUrl.js for the full
// authenticated-blob-URL rationale.
function InventoryItemPhoto({ item }) {
  const photoObjectUrl = useAuthedImageUrl(item.photo_url)
  const alt = item.identified_name
    ? `Photo of ${item.identified_name}`
    : `Photo of item #${item.id}`

  if (!item.photo_url) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border text-center text-xs text-text">
        No photo
      </div>
    )
  }

  if (!photoObjectUrl) {
    return (
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border text-center text-xs text-text"
        data-testid="photo-placeholder"
      >
        Loading...
      </div>
    )
  }

  return (
    <img className="h-16 w-16 shrink-0 rounded object-cover" src={photoObjectUrl} alt={alt} />
  )
}

// The basement inventory list, rendered at `/inventory` (sandbox-yqf.11).
// Lists every `Item` (photo thumbnail, decision, status), filterable in
// memory by status (chips) and decision (tiles), with per-item
// buttons to manually advance status to any currently-valid next state
// via `PATCH /items/{id}/status`. Which statuses are valid next states is
// NOT duplicated here -- it's read directly from each item's
// `valid_next_statuses` field, which the backend derives server-side from
// `MANUAL_STATUS_TRANSITIONS` (see backend/app/main.py) and includes in
// every `GET /items`/`GET /items/{id}` response (sandbox-yqf.21).
function InventoryPage() {
  const [items, setItems] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [updateError, setUpdateError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const loadItems = useCallback(
    async (signal) => {
      setLoading(true)
      setLoadError('')
      try {
        const data = await fetchItems(signal)
        setItems(data)
      } catch (err) {
        if (err.name === 'AbortError') return
        setLoadError(err.message || 'Could not load inventory.')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadItems(controller.signal)
    return () => controller.abort()
  }, [loadItems])

  async function handleAdvance(item, targetStatus) {
    setUpdatingId(item.id)
    setUpdateError('')
    try {
      const updated = await patchItemStatus(item.id, targetStatus)
      setItems((prev) => prev.map((existing) => (existing.id === item.id ? updated : existing)))
    } catch (err) {
      setUpdateError(err.message || 'Could not update status.')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleDelete(item) {
    if (!window.confirm('Delete this item? This cannot be undone.')) {
      return
    }
    setDeletingId(item.id)
    setDeleteError('')
    try {
      await deleteItem(item.id)
      setItems((prev) => prev.filter((existing) => existing.id !== item.id))
    } catch (err) {
      setDeleteError(err.message || 'Could not delete item.')
    } finally {
      setDeletingId(null)
    }
  }

  const decisionCounts = { sell: 0, give_away: 0, throw_away: 0, pending: 0 }
  let waitingCount = 0
  let sellValue = 0
  for (const item of items) {
    if (item.decision in decisionCounts) decisionCounts[item.decision] += 1
    if (item.status === 'decided') waitingCount += 1
    if (item.decision === 'sell' && (item.status === 'decided' || item.status === 'listed')) {
      sellValue += Number(item.suggested_price) || 0
    }
  }
  const visibleItems = items.filter(
    (item) =>
      (!decisionFilter || item.decision === decisionFilter) &&
      (!statusFilter || item.status === statusFilter),
  )
  const loaded = !loading && !loadError
  const alertClasses = 'mt-4 rounded-2xl border border-toss bg-toss-soft px-4 py-3 text-sm text-toss'

  function clearFilters() {
    setStatusFilter('')
    setDecisionFilter('')
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Basement Inventory
          </h1>
          {loaded && (
            <p className="mt-1 text-muted">
              {items.length} {items.length === 1 ? 'item' : 'items'} · {waitingCount} waiting on
              you
              {sellValue > 0 && <> · ~{formatPrice(Math.round(sellValue))} to sell</>}
            </p>
          )}
        </div>
        <Link
          to="/"
          className="hidden items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-primary-hover sm:inline-flex"
        >
          <Plus size={16} strokeWidth={2.4} />
          Add item
        </Link>
      </div>

      {loaded && items.length > 0 && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DECISION_FILTER_OPTIONS.map((value) => {
              const on = decisionFilter === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDecisionFilter(on ? '' : value)}
                  className={`cursor-pointer rounded-2xl border bg-surface p-3.5 text-left transition ${
                    on ? 'border-primary ring-4 ring-primary-soft' : 'border-line hover:border-muted'
                  }`}
                >
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${DECISION_TILE_PILL_CLASSES[value]}`}
                  >
                    {DECISION_LABELS[value]}
                  </span>
                  <span className="mt-2 block font-display text-2xl font-bold text-ink">
                    {decisionCounts[value]}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {['', ...STATUS_FILTER_OPTIONS].map((value) => {
                const on = statusFilter === value
                return (
                  <button
                    key={value || 'all'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStatusFilter(value)}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                      on
                        ? 'border-ink bg-ink font-semibold text-ground'
                        : 'border-line bg-surface text-ink hover:bg-sunken'
                    }`}
                  >
                    {value ? STATUS_LABELS[value] : 'All'}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {updateError && (
        <div className={alertClasses} role="alert">
          <p>{updateError}</p>
        </div>
      )}

      {deleteError && (
        <div className={alertClasses} role="alert">
          <p>{deleteError}</p>
        </div>
      )}

      {loadError && (
        <div className={alertClasses} role="alert">
          <p>{loadError}</p>
        </div>
      )}

      {loading && (
        <p className="mt-5 text-muted" role="status">
          Loading inventory...
        </p>
      )}

      {loaded && items.length === 0 && (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-line px-6 py-14 text-center">
          <p className="font-semibold text-ink">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted">
            Photograph your first basement item to get a recommendation.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Add item
          </Link>
        </div>
      )}

      {loaded && items.length > 0 && visibleItems.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          <p>No items match these filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-2 cursor-pointer font-semibold text-primary hover:text-primary-hover"
          >
            Clear filters
          </button>
        </div>
      )}

      {loaded && visibleItems.length > 0 && (
        <ul className="mt-5 grid list-none gap-3 p-0 text-left lg:grid-cols-2">
          {visibleItems.map((item) => {
            const nextStatuses = item.valid_next_statuses || []
            const decisionBadgeClasses =
              DECISION_BADGE_CLASSES[item.decision] || DECISION_BADGE_CLASSES.pending
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-4 border-b border-border py-4 last:border-b-0 sm:items-center"
              >
                <div className="flex min-w-[200px] flex-1 items-center gap-4">
                  <InventoryItemPhoto item={item} />

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/items/${item.id}`}
                      className="link block font-medium break-words"
                    >
                      {item.identified_name || `Item #${item.id}`}
                    </Link>
                    <p className="mt-1">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${decisionBadgeClasses}`}
                      >
                        {DECISION_LABELS[item.decision] || item.decision}
                      </span>
                      {/* Low-confidence badge (sandbox-8jm.7) -- same
                          decision_confidence field as ItemResultPage.jsx,
                          fits inline right after the decision badge without
                          restructuring this row's layout. */}
                      {item.decision_confidence === 'low' && (
                        <span
                          className="ml-1 inline-block rounded-full border border-pending-border bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending-text"
                          role="status"
                        >
                          {item.decision === 'throw_away' &&
                          (item.comparable_listings || []).length === 0
                            ? 'No comparable listings found — double-check'
                            : 'Few comparable listings — double-check the price'}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-text">
                      Status: {STATUS_LABELS[item.status] || item.status}
                    </p>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-1.5 sm:w-48">
                  {nextStatuses.map((targetStatus) => (
                    <button
                      key={targetStatus}
                      type="button"
                      disabled={updatingId === item.id || deletingId === item.id}
                      onClick={() => handleAdvance(item, targetStatus)}
                      className="cursor-pointer rounded border border-primary bg-primary px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:border-primary-hover hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {STATUS_ACTION_LABELS[targetStatus]}
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={updatingId === item.id || deletingId === item.id}
                    onClick={() => handleDelete(item)}
                    className="cursor-pointer rounded border border-throw-away-border bg-throw-away-bg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-throw-away-text hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default InventoryPage

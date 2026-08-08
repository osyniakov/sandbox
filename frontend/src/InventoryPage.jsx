import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from './api.js'

const STATUS_ACTION_LABELS = {
  listed: 'Mark as listed on Kleinanzeigen',
  given_away: 'Mark as given away',
  disposed: 'Mark as disposed',
}

const STATUS_LABELS = {
  pending_identification: 'Pending identification',
  pending_search: 'Pending search',
  pending_decision: 'Pending decision',
  decided: 'Decided',
  listed: 'Listed',
  given_away: 'Given away',
  disposed: 'Disposed',
}

const DECISION_LABELS = {
  pending: 'Pending',
  sell: 'Sell',
  give_away: 'Give away',
  throw_away: 'Throw away',
}

const STATUS_FILTER_OPTIONS = Object.keys(STATUS_LABELS)
const DECISION_FILTER_OPTIONS = Object.keys(DECISION_LABELS)

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

async function fetchItems(statusFilter, decisionFilter, signal) {
  const params = new URLSearchParams()
  if (statusFilter) params.set('status', statusFilter)
  if (decisionFilter) params.set('decision', decisionFilter)
  const query = params.toString()
  const response = await fetch(`${API_BASE_URL}/items${query ? `?${query}` : ''}`, {
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load items (${response.status} ${response.statusText})`)
  }
  return response.json()
}

async function patchItemStatus(id, status, signal) {
  const response = await fetch(`${API_BASE_URL}/items/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  })
  if (!response.ok) {
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

// The basement inventory list, rendered at `/inventory` (sandbox-yqf.11).
// Lists every `Item` (photo thumbnail, decision, status), filterable by
// `status`/`decision` via `GET /items` query params, with per-item
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

  const loadItems = useCallback(
    async (signal) => {
      setLoading(true)
      setLoadError('')
      try {
        const data = await fetchItems(statusFilter, decisionFilter, signal)
        setItems(data)
      } catch (err) {
        if (err.name === 'AbortError') return
        setLoadError(err.message || 'Could not load inventory.')
      } finally {
        setLoading(false)
      }
    },
    [statusFilter, decisionFilter],
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-center">
      <h1>Basement Inventory</h1>

      <p className="mt-2">
        <Link to="/" className="link">
          Upload another photo
        </Link>
      </p>

      <div className="mt-6 mb-6 flex flex-wrap justify-center gap-6">
        <label
          htmlFor="status-filter"
          className="flex flex-col items-start gap-1 text-sm font-semibold text-heading"
        >
          Status
          <select
            id="status-filter"
            className="form-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_FILTER_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label
          htmlFor="decision-filter"
          className="flex flex-col items-start gap-1 text-sm font-semibold text-heading"
        >
          Decision
          <select
            id="decision-filter"
            className="form-select"
            value={decisionFilter}
            onChange={(event) => setDecisionFilter(event.target.value)}
          >
            <option value="">All decisions</option>
            {DECISION_FILTER_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {DECISION_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {updateError && (
        <div
          className="mb-4 rounded border border-throw-away-border bg-throw-away-bg px-4 py-3 text-throw-away-text"
          role="alert"
        >
          <p>{updateError}</p>
        </div>
      )}

      {loadError && (
        <div
          className="mb-4 rounded border border-throw-away-border bg-throw-away-bg px-4 py-3 text-throw-away-text"
          role="alert"
        >
          <p>{loadError}</p>
        </div>
      )}

      {loading && (
        <p className="italic text-text" role="status">
          Loading inventory...
        </p>
      )}

      {!loading && !loadError && items.length === 0 && <p>No items match these filters.</p>}

      {!loading && !loadError && items.length > 0 && (
        <ul className="m-0 list-none p-0 text-left">
          {items.map((item) => {
            const nextStatuses = item.valid_next_statuses || []
            const decisionBadgeClasses =
              DECISION_BADGE_CLASSES[item.decision] || DECISION_BADGE_CLASSES.pending
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-4 border-b border-border py-4 last:border-b-0 sm:items-center"
              >
                <div className="flex min-w-[200px] flex-1 items-center gap-4">
                  {item.photo_url ? (
                    <img
                      className="h-16 w-16 shrink-0 rounded object-cover"
                      src={`${API_BASE_URL}${item.photo_url}`}
                      alt={
                        item.identified_name
                          ? `Photo of ${item.identified_name}`
                          : `Photo of item #${item.id}`
                      }
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border text-center text-xs text-text">
                      No photo
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <Link to={`/items/${item.id}`} className="link block truncate font-medium">
                      {item.identified_name || `Item #${item.id}`}
                    </Link>
                    <p className="mt-1">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${decisionBadgeClasses}`}
                      >
                        {DECISION_LABELS[item.decision] || item.decision}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-text">
                      Status: {STATUS_LABELS[item.status] || item.status}
                    </p>
                  </div>
                </div>

                {nextStatuses.length > 0 && (
                  <div className="flex w-full flex-col gap-1.5 sm:w-48">
                    {nextStatuses.map((targetStatus) => (
                      <button
                        key={targetStatus}
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => handleAdvance(item, targetStatus)}
                        className="cursor-pointer rounded border border-primary bg-primary px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:border-primary-hover hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {STATUS_ACTION_LABELS[targetStatus]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default InventoryPage

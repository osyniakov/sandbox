import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from './api.js'

// Mirrors the backend's `MANUAL_STATUS_TRANSITIONS` table exactly (see
// backend/app/main.py's docstring above that constant for the full
// design-decision writeup / reasoning -- this frontend copy exists only
// so status-advance buttons can be disabled/hidden for transitions that
// would just 400, not to re-derive or second-guess the backend's rules).
// Keep these two tables in sync if the backend's ever changes.
const MANUAL_STATUS_TRANSITIONS = {
  pending_identification: [],
  pending_search: [],
  pending_decision: [],
  decided: ['listed', 'given_away', 'disposed'],
  listed: ['given_away', 'disposed'],
  given_away: ['listed', 'disposed'],
  disposed: ['listed', 'given_away'],
}

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
// (per `MANUAL_STATUS_TRANSITIONS` above) via `PATCH /items/{id}/status`.
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
    <div className="placeholder inventory-page">
      <h1>Basement Inventory</h1>

      <p>
        <Link to="/">Upload another photo</Link>
      </p>

      <div className="inventory-filters">
        <label htmlFor="status-filter">
          Status
          <select
            id="status-filter"
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

        <label htmlFor="decision-filter">
          Decision
          <select
            id="decision-filter"
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
        <div className="error" role="alert">
          <p>{updateError}</p>
        </div>
      )}

      {loadError && (
        <div className="error" role="alert">
          <p>{loadError}</p>
        </div>
      )}

      {loading && <p className="status" role="status">Loading inventory...</p>}

      {!loading && !loadError && items.length === 0 && <p>No items match these filters.</p>}

      {!loading && !loadError && items.length > 0 && (
        <ul className="inventory-list">
          {items.map((item) => {
            const nextStatuses = MANUAL_STATUS_TRANSITIONS[item.status] || []
            return (
              <li key={item.id} className="inventory-item">
                {item.photo_url ? (
                  <img
                    className="inventory-thumb"
                    src={`${API_BASE_URL}${item.photo_url}`}
                    alt={
                      item.identified_name
                        ? `Photo of ${item.identified_name}`
                        : `Photo of item #${item.id}`
                    }
                  />
                ) : (
                  <div className="inventory-thumb inventory-thumb-placeholder">No photo</div>
                )}

                <div className="inventory-item-details">
                  <Link to={`/items/${item.id}`}>
                    {item.identified_name || `Item #${item.id}`}
                  </Link>
                  <p className="inventory-decision">
                    Decision: {DECISION_LABELS[item.decision] || item.decision}
                  </p>
                  <p className="inventory-status">
                    Status: {STATUS_LABELS[item.status] || item.status}
                  </p>
                </div>

                {nextStatuses.length > 0 && (
                  <div className="inventory-actions">
                    {nextStatuses.map((targetStatus) => (
                      <button
                        key={targetStatus}
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => handleAdvance(item, targetStatus)}
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from './api.js'
import { formatPrice } from './format.js'
import { Check, Plus, Trash } from './icons.jsx'
import {
  DECISION_LABELS,
  DECISION_PILL_CLASSES,
  DECISION_PRIMARY_STATUS,
  STATUS_ACTION_LABELS,
  patchItemStatus,
} from './itemsApi.js'
import ItemPhoto from './ItemPhoto.jsx'

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

const STATUS_FILTER_OPTIONS = Object.keys(STATUS_LABELS)
const DECISION_FILTER_OPTIONS = Object.keys(DECISION_LABELS)

const DONE_STATUSES = ['listed', 'given_away', 'disposed']

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

function lowConfidenceCopy(item) {
  return item.decision === 'throw_away' && (item.comparable_listings || []).length === 0
    ? 'No comparable listings found — double-check'
    : 'Few comparable listings — double-check the price'
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
  const [confirmItem, setConfirmItem] = useState(null)
  const deleteTriggerRef = useRef(null)
  const cancelRef = useRef(null)
  const dialogRef = useRef(null)

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

  function openDeleteDialog(item, trigger) {
    deleteTriggerRef.current = trigger
    setConfirmItem(item)
  }

  function closeDeleteDialog() {
    setConfirmItem(null)
    const trigger = deleteTriggerRef.current
    deleteTriggerRef.current = null
    if (trigger && trigger.isConnected) trigger.focus()
  }

  async function handleDelete(item) {
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

  const dialogOpen = confirmItem !== null
  useEffect(() => {
    if (!dialogOpen) return undefined
    cancelRef.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDeleteDialog()
      } else if (event.key === 'Tab' && dialogRef.current) {
        const buttons = dialogRef.current.querySelectorAll('button')
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // closeDeleteDialog only touches state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen])

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
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${DECISION_PILL_CLASSES[value]}`}
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
              DECISION_PILL_CLASSES[item.decision] || DECISION_PILL_CLASSES.pending
            const done = DONE_STATUSES.includes(item.status)
            const working = item.status.startsWith('pending')
            const busy = updatingId === item.id || deletingId === item.id
            const primaryStatus = DECISION_PRIMARY_STATUS[item.decision]
            const hasPrice = item.suggested_price !== null && item.suggested_price !== undefined && item.suggested_price !== ''
            return (
              <li
                key={item.id}
                className={`flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card ${
                  done ? 'opacity-70' : ''
                }`}
              >
                <Link to={`/items/${item.id}`} tabIndex={-1} className="shrink-0">
                  <ItemPhoto item={item} />
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start gap-2">
                    <Link
                      to={`/items/${item.id}`}
                      className="min-w-0 flex-1 font-semibold leading-snug break-words [overflow-wrap:anywhere] hover:text-primary"
                    >
                      {item.identified_name || `Item #${item.id}`}
                    </Link>
                    {hasPrice && (
                      <span className="font-mono text-sm text-ink">
                        {formatPrice(Number(item.suggested_price))}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${decisionBadgeClasses}`}
                    >
                      {DECISION_LABELS[item.decision] || item.decision}
                    </span>
                    {/* Low-confidence badge (sandbox-8jm.7): short visible
                        label, full copy kept as accessible text and title. */}
                    {item.decision_confidence === 'low' && (
                      <span
                        className="inline-flex rounded-full bg-warn-soft px-2 py-0.5 font-semibold text-warn"
                        role="status"
                        title={lowConfidenceCopy(item)}
                      >
                        <span aria-hidden="true">Check price</span>
                        <span className="sr-only">{lowConfidenceCopy(item)}</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      {working && (
                        <span className="pulse h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                      )}
                      {done && <Check size={12} strokeWidth={3} />}
                      <span>Status: {STATUS_LABELS[item.status] || item.status}</span>
                    </span>
                    {item.category && <span>· {item.category}</span>}
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    {nextStatuses.map((targetStatus) => {
                      const primary = targetStatus === primaryStatus
                      return (
                        <button
                          key={targetStatus}
                          type="button"
                          disabled={busy}
                          onClick={() => handleAdvance(item, targetStatus)}
                          className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${
                            primary
                              ? 'border border-primary bg-primary text-white hover:bg-primary-hover'
                              : 'border border-line bg-surface text-ink hover:bg-sunken'
                          }`}
                        >
                          {STATUS_ACTION_LABELS[targetStatus]}
                        </button>
                      )
                    })}

                    <button
                      type="button"
                      disabled={busy}
                      aria-label={deletingId === item.id ? 'Deleting...' : 'Delete'}
                      title={deletingId === item.id ? 'Deleting...' : 'Delete'}
                      onClick={(event) => openDeleteDialog(item, event.currentTarget)}
                      className="ml-auto cursor-pointer rounded-full p-1.5 text-muted hover:bg-toss-soft hover:text-toss disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {confirmItem && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          onClick={closeDeleteDialog}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            className="w-full max-w-sm rounded-2xl bg-surface p-5 text-ink shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <p id="delete-dialog-title" className="font-semibold">
              Delete this item?
            </p>
            <p className="mt-1 text-sm text-muted">
              “{confirmItem.identified_name || `Item #${confirmItem.id}`}” and its photo will be
              removed for good.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={closeDeleteDialog}
                className="cursor-pointer rounded-full px-4 py-2 text-sm font-semibold hover:bg-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const item = confirmItem
                  closeDeleteDialog()
                  handleDelete(item)
                }}
                className="cursor-pointer rounded-full bg-toss px-4 py-2 text-sm font-semibold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default InventoryPage

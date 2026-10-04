import { apiFetch } from './api.js'

// Button labels for the manual status transitions, shared by the inventory
// list and the item result page.
export const STATUS_ACTION_LABELS = {
  listed: 'Mark as listed on Kleinanzeigen',
  given_away: 'Mark as given away',
  disposed: 'Mark as disposed',
}

// Which status action is the recommended one for each decision.
export const DECISION_PRIMARY_STATUS = {
  sell: 'listed',
  give_away: 'given_away',
  throw_away: 'disposed',
}

export async function patchItemStatus(id, status, signal) {
  const response = await apiFetch(`/items/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  })
  if (!response.ok) {
    // A 401 means the session expired -- apiFetch (api.js) has already
    // cleared the stale token and dispatched SESSION_EXPIRED_EVENT.
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

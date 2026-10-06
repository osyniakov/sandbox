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

export const DECISION_LABELS = {
  sell: 'Sell',
  give_away: 'Give away',
  throw_away: 'Throw away',
  pending: 'Pending',
}

// Decision pill classes (semantic tokens), shared by inventory and upload pages.
export const DECISION_PILL_CLASSES = {
  sell: 'bg-sell-soft text-sell',
  give_away: 'bg-give-soft text-give',
  throw_away: 'bg-toss-soft text-toss',
  pending: 'bg-sunken text-muted',
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

async function failureMessage(response, fallback) {
  // A 401 means the session expired -- apiFetch (api.js) has already
  // cleared the stale token and dispatched SESSION_EXPIRED_EVENT.
  if (response.status === 401) {
    return 'Your session has expired. Please sign in again.'
  }
  let detail = `${fallback} (${response.status} ${response.statusText})`
  try {
    const body = await response.json()
    if (body && typeof body.detail === 'string') {
      detail = body.detail
    }
  } catch {
    // Body wasn't JSON -- keep the generic message.
  }
  return detail
}

// Appends photos to an item; resolves to the serialized item.
export async function addItemPhotos(id, files, signal) {
  const form = new FormData()
  for (const file of files) {
    form.append('photos', file)
  }
  const response = await apiFetch(`/items/${id}/photos`, { method: 'POST', body: form, signal })
  if (!response.ok) {
    throw new Error(await failureMessage(response, 'Failed to add photos'))
  }
  return response.json()
}

// Removes one photo from an item; resolves to the serialized item.
export async function removeItemPhoto(id, photoId, signal) {
  const response = await apiFetch(`/items/${id}/photos/${photoId}`, { method: 'DELETE', signal })
  if (!response.ok) {
    throw new Error(await failureMessage(response, 'Failed to remove photo'))
  }
  return response.json()
}

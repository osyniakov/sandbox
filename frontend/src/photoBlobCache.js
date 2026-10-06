import { apiFetch } from './api.js'

// Module-level, url-keyed cache of authenticated photo blobs, shared by the
// display hook (useAuthedImageUrl) and the Save path (savePhotos/PhotoCarousel)
// so each /uploads photo is downloaded once. Only /uploads photos should go
// through it (see isCacheablePhotoUrl).
//
// Entry: { promise, blob }. `blob` is set once resolved. Eviction: failed
// fetches are dropped (retry refetches); least-recently-used entries are
// dropped beyond MAX_ENTRIES. Evicting never revokes object URLs: the hook
// owns those.
export const MAX_ENTRIES = 30

const cache = new Map()

export function isCacheablePhotoUrl(url) {
  return typeof url === 'string' && url.startsWith('/uploads/')
}

// Uncached authenticated blob fetch. Typed blob (falls back to the response
// Content-Type header, then image/jpeg).
export async function fetchPhotoBlob(url) {
  const response = await apiFetch(url)
  if (!response.ok) {
    throw new Error(`Could not load the photo (${response.status || 'error'}).`)
  }
  const blob = await response.blob()
  if (blob.type) return blob
  const type = response.headers?.get?.('Content-Type') || 'image/jpeg'
  return new Blob([blob], { type })
}

function touch(url, entry) {
  cache.delete(url)
  cache.set(url, entry)
}

export function getPhotoBlob(url) {
  const existing = cache.get(url)
  if (existing) {
    touch(url, existing)
    return existing.promise
  }
  const entry = { promise: null, blob: null }
  entry.promise = fetchPhotoBlob(url).then(
    (blob) => {
      entry.blob = blob
      return blob
    },
    (err) => {
      if (cache.get(url) === entry) cache.delete(url)
      throw err
    },
  )
  entry.promise.catch(() => {}) // callers handle their own rejection
  cache.set(url, entry)
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
  return entry.promise
}

// Resolved Blob or undefined, synchronously.
export function peekPhotoBlob(url) {
  const entry = cache.get(url)
  if (!entry?.blob) return undefined
  touch(url, entry)
  return entry.blob
}

export function evictPhotoBlob(url) {
  cache.delete(url)
}

export function __resetPhotoBlobCacheForTests() {
  cache.clear()
}

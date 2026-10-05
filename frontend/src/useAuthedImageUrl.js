import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'

// Authenticated photo-fetch hook (sandbox-dfr.5, CRITICAL fix flagged in
// that bead's review). `GET /uploads/{filename}` (sandbox-dfr.3) now
// requires an `Authorization: Bearer <token>` header, but a plain
// `<img src="...">` has no way to attach a custom header to the request the
// browser makes for that `src` -- so pointing an `<img>` directly at a
// relative `photo_url` would 401 for every photo once that backend change
// ships. Deliberately NOT solved via a `?token=` query-param fallback on
// the backend (that would add a second, weaker auth pathway -- tokens
// leaking into browser history and server access logs -- and was
// deliberately rejected in favor of this approach): instead the frontend
// fetches the photo bytes authenticated (via `apiFetch`, so the exact same
// Authorization header + 401 handling as every other request in this app
// applies here too) and renders them as a `blob:` object URL.
//
// Given a `photoUrl` (the relative `/uploads/<file>` path from the API --
// e.g. `Item.photo_url`, see backend/app/models.py -- or `null`/`undefined`
// if the item has no photo yet, same as before this hook existed), returns
// `{ url, status }`: `status` is 'idle' (no photoUrl), 'loading' (fetch in
// flight), 'loaded' (`url` is the blob: object URL) or 'error' (non-OK
// response incl. 404/401, or network failure; `url` is null). Callers render
// a loading placeholder only for 'loading' and "Photo unavailable" for 'error'.
//
// A 401 from `apiFetch` here is exactly the same "session expired mid-use"
// failure mode as any other authenticated request in this app -- `apiFetch`
// (api.js) already clears the stale token and dispatches
// `SESSION_EXPIRED_EVENT` itself on a 401, which `AuthContext` listens for
// to flip the whole app back to the sign-in gate. This hook deliberately
// does NOT build a second error-handling mechanism on top of that: it just
// reports status 'error' (so the caller shows a placeholder, never a
// broken image) and lets that shared mechanism take over.
export function useAuthedImageUrl(photoUrl) {
  // `key` records which photoUrl the result belongs to, so a render right
  // after photoUrl changes never exposes the previous photo's (revoked) URL.
  const [result, setResult] = useState({ key: null, url: null, status: 'idle' })

  useEffect(() => {
    if (!photoUrl) return undefined

    let cancelled = false
    let createdUrl = null
    setResult({ key: photoUrl, url: null, status: 'loading' })

    async function load() {
      try {
        const response = await apiFetch(photoUrl)
        if (cancelled) return
        if (!response.ok) {
          // Includes 404 and the 401 case described above (apiFetch has
          // already reacted to the 401): a terminal failure for this image.
          setResult({ key: photoUrl, url: null, status: 'error' })
          return
        }
        const blob = await response.blob()
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setResult({ key: photoUrl, url: createdUrl, status: 'loaded' })
      } catch {
        // Network error, etc. Aborted/cancelled requests (unmount or
        // photoUrl change) must not report an error.
        if (!cancelled) setResult({ key: photoUrl, url: null, status: 'error' })
      }
    }

    load()

    // Revoke on unmount OR when photoUrl changes (this effect re-runs),
    // so a page that renders many photo thumbnails (InventoryPage) doesn't
    // leak one object URL per item forever.
    return () => {
      cancelled = true
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [photoUrl])

  if (!photoUrl) return { url: null, status: 'idle' }
  if (result.key !== photoUrl) return { url: null, status: 'loading' }
  return { url: result.url, status: result.status }
}

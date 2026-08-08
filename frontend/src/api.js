// Configurable via a Vite env var so the frontend can be pointed at a
// different backend (e.g. a docker-compose service name, or a deployed
// host) without code changes. See `.env.example`.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// The Google OAuth 2.0 client ID this frontend was registered under with
// Google Identity Services (GIS). Configurable via a Vite env var,
// mirroring `API_BASE_URL` above -- see `.env.example`. Consumed by
// `SignInPage.jsx` to initialize `window.google.accounts.id`.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

// The single localStorage key under which this app's session token (the
// opaque string returned by `POST /auth/google`, NOT the raw Google ID
// token) is stored. Exported so every piece of code that reads or writes
// the session token (this file's `apiFetch`, `AuthContext.jsx`'s
// `completeSignIn`/`signOut`/mount check, `SignInPage.jsx`) agrees on the
// exact same key -- do not hardcode this string anywhere else.
export const SESSION_TOKEN_STORAGE_KEY = 'basement-declutter-session-token'

// The `window` CustomEvent name `apiFetch` dispatches when it discovers a
// stored session token is no longer valid (a 401 response to an
// authenticated request). See `apiFetch`'s docstring below for the full
// contract; `AuthContext.jsx` listens for this to flip its React state.
export const SESSION_EXPIRED_EVENT = 'auth:session-expired'

// Authenticated fetch helper: wraps the platform `fetch` so every
// authenticated call in this app (currently just `AuthContext`'s mount
// check; a later bead, sandbox-dfr.5, will migrate UploadPage/
// ItemResultPage/InventoryPage's own fetch calls to use this too) shares
// one place that attaches the session token and reacts to it going stale.
//
// Contract:
//   - Reads the session token from `localStorage` under
//     `SESSION_TOKEN_STORAGE_KEY`. If present, merges an
//     `Authorization: Bearer <token>` header into `options.headers`
//     (without clobbering any other headers the caller passed) before
//     calling `fetch(`${API_BASE_URL}${path}`, mergedOptions)`. If absent,
//     the request is sent without an Authorization header at all (the
//     caller may still be hitting a public endpoint).
//   - If the response comes back with `status === 401`, this means the
//     session is dead (missing, expired, tampered, or simply never valid)
//     from the backend's point of view. In that case `apiFetch`:
//       1. Clears the stored token from `localStorage` (so a fresh page
//          load won't keep trying a token the backend has already
//          rejected).
//       2. Dispatches a `window` `CustomEvent(SESSION_EXPIRED_EVENT)` so
//          any listener (namely `AuthContext`) can update its React state
//          reactively and show the sign-in gate again.
//     `apiFetch` deliberately does NOT do a hard `window.location`
//     redirect itself -- it's a low-level helper with no opinion on how
//     the app should navigate; that's `AuthContext`'s (and ultimately the
//     UI's) job via the event above.
//   - The 401 response is still returned to the caller as-is (this
//     function does not swallow it) -- callers that care about the error
//     message should still check `response.ok`/`response.status`
//     themselves, same as a plain `fetch` call.
export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)

  const mergedOptions = { ...options }
  if (token) {
    mergedOptions.headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, mergedOptions)

  if (response.status === 401) {
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  }

  return response
}

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { API_BASE_URL, SESSION_EXPIRED_EVENT, SESSION_TOKEN_STORAGE_KEY } from './api.js'

// Auth gate for the whole app (sandbox-dfr.4). This context is the single
// source of truth for "is there a signed-in user right now", backed by
// the session token this app issues itself (`POST /auth/google`, see
// backend/app/main.py) and stores in `localStorage` under
// `SESSION_TOKEN_STORAGE_KEY` (api.js).
//
// Shape: `{ email, isAuthenticated, isLoading, signOut, completeSignIn }`.
//   - `isLoading` is true only during the initial mount check (validating
//     any stored token against `GET /auth/me`); App.jsx uses this to show
//     a loading state instead of flashing the sign-in page before
//     flipping to the authenticated app (or vice versa).
//   - `completeSignIn(token, email)` is called by SignInPage.jsx once it
//     has successfully exchanged a Google ID token for one of this app's
//     session tokens via `POST /auth/google`.
//   - `signOut()` is exposed here for a later bead (sandbox-dfr.5) to
//     wire up an actual sign-out control; this bead only needs it to
//     work correctly when called.
//   - Session expiry mid-session: `api.js`'s `apiFetch` helper clears the
//     stored token AND dispatches a `window` `CustomEvent`
//     (`SESSION_EXPIRED_EVENT`) itself whenever an authenticated request
//     comes back 401, rather than doing a hard redirect from that
//     low-level helper. This provider listens for that event and updates
//     its React state accordingly, so the sign-in gate reappears
//     reactively without a page reload.
const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [email, setEmail] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Initial mount check: if a token is already stored (e.g. from a
  // previous visit), validate it against `GET /auth/me` before deciding
  // whether to show the app or the sign-in gate. If there's no stored
  // token at all, skip the network round-trip entirely -- there's
  // nothing to validate.
  useEffect(() => {
    let cancelled = false

    async function checkExistingSession() {
      const token = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
      if (!token) {
        if (!cancelled) {
          setIsAuthenticated(false)
          setEmail(null)
          setIsLoading(false)
        }
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!response.ok) {
          localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
          if (!cancelled) {
            setIsAuthenticated(false)
            setEmail(null)
          }
          return
        }

        const body = await response.json()
        if (!cancelled) {
          setIsAuthenticated(true)
          setEmail(body.email)
        }
      } catch {
        // Network error (backend unreachable, offline, etc.) -- treat the
        // stored token as unusable for now rather than assuming it's
        // valid; the user can retry once connectivity is back.
        if (!cancelled) {
          setIsAuthenticated(false)
          setEmail(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    checkExistingSession()

    return () => {
      cancelled = true
    }
  }, [])

  // Mid-session expiry: apiFetch (api.js) already clears the stored token
  // and dispatches this event on any 401 -- this listener's only job is
  // to update React state so the UI re-renders the sign-in gate.
  useEffect(() => {
    function handleSessionExpired() {
      setIsAuthenticated(false)
      setEmail(null)
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    }
  }, [])

  const completeSignIn = useCallback((token, signedInEmail) => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token)
    setIsAuthenticated(true)
    setEmail(signedInEmail)
  }, [])

  const signOut = useCallback(async () => {
    const token = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
    try {
      if (token) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch {
      // Best-effort: /auth/logout is a stateless no-op on the backend
      // (sandbox-dfr.2), so there's nothing to reconcile if this call
      // fails (network error, backend down, etc.) -- the important part
      // (clearing the local session below) still happens regardless.
    } finally {
      localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
      setIsAuthenticated(false)
      setEmail(null)
    }
  }, [])

  const value = { email, isAuthenticated, isLoading, signOut, completeSignIn }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

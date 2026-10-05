import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, GOOGLE_CLIENT_ID } from './api.js'
import { useAuth } from './AuthContext.jsx'
import { AlertCircle, Box } from './icons.jsx'

// How often (ms) to poll for `window.google` while waiting for the
// Google Identity Services (GIS) script (loaded `async defer` from
// index.html) to finish loading, and how long to keep polling before
// giving up and showing an error instead of silently doing nothing.
const GOOGLE_SCRIPT_POLL_INTERVAL_MS = 100
const GOOGLE_SCRIPT_POLL_TIMEOUT_MS = 8000

// Extracts a human-readable message from a failed `POST /auth/google`
// response. Mirrors UploadPage.jsx's `extractErrorMessage` helper: the
// backend returns FastAPI-style `{"detail": "..."}` bodies for its 4xx
// errors (e.g. 401 for an email not on the whitelist -- see
// backend/app/main.py's `auth_google`).
async function extractErrorMessage(response) {
  try {
    const body = await response.json()
    if (body && typeof body.detail === 'string') {
      return body.detail
    }
  } catch {
    // Response body wasn't JSON -- fall through to the generic message.
  }
  if (response.status === 401) {
    return 'This Google account is not authorized to use this app.'
  }
  return `Sign-in failed (${response.status} ${response.statusText})`
}

// The auth gate's sign-in screen: rendered by App.jsx instead of the
// routed app whenever `isAuthenticated` is false. Renders the app's
// branding (matching UploadPage.jsx's established look) plus a container
// `<div>` that Google Identity Services renders its own "Sign in with
// Google" button into.
function SignInPage() {
  const buttonContainerRef = useRef(null)
  const { completeSignIn } = useAuth()
  const [errorMessage, setErrorMessage] = useState('')
  const [scriptLoadFailed, setScriptLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let pollIntervalId
    let timeoutId

    async function handleCredentialResponse(response) {
      setErrorMessage('')
      try {
        const result = await fetch(`${API_BASE_URL}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_token: response.credential }),
        })

        if (!result.ok) {
          const message = await extractErrorMessage(result)
          setErrorMessage(message)
          return
        }

        let body
        try {
          body = await result.json()
        } catch {
          body = null
        }
        const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0
        if (!body || !isNonEmptyString(body.token) || !isNonEmptyString(body.email)) {
          setErrorMessage(
            `Sign-in failed (${result.status} ${result.statusText}): unexpected response from the server.`,
          )
          return
        }
        completeSignIn(body.token, body.email)
      } catch {
        // Network error (backend unreachable, offline, etc.).
        setErrorMessage('Could not reach the server. Check your connection and try again.')
      }
    }

    function initializeGoogleSignIn() {
      if (cancelled || !buttonContainerRef.current) {
        return
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      })
      window.google.accounts.id.renderButton(buttonContainerRef.current, {
        theme: 'outline',
        size: 'large',
      })
    }

    // The GIS script (index.html) is loaded `async defer`, so
    // `window.google` may not exist yet when this component mounts --
    // poll briefly for it rather than assuming it's ready.
    if (window.google?.accounts?.id) {
      initializeGoogleSignIn()
    } else {
      pollIntervalId = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(pollIntervalId)
          clearTimeout(timeoutId)
          initializeGoogleSignIn()
        }
      }, GOOGLE_SCRIPT_POLL_INTERVAL_MS)

      timeoutId = setTimeout(() => {
        clearInterval(pollIntervalId)
        if (!cancelled && !window.google?.accounts?.id) {
          setScriptLoadFailed(true)
        }
      }, GOOGLE_SCRIPT_POLL_TIMEOUT_MS)
    }

    return () => {
      cancelled = true
      clearInterval(pollIntervalId)
      clearTimeout(timeoutId)
    }
  }, [completeSignIn])

  return (
    <div className="px-4 py-16 sm:py-24">
      <div className="mx-auto max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-white">
            <Box size={22} />
          </span>
          <h1 className="font-display text-lg font-bold tracking-tight">
            Basement Declutter
          </h1>
        </div>
        <p className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink">
          Sell it, gift it, or bin it.
        </p>
        <p className="mt-3 text-muted">
          Snap a photo of anything in the basement. We identify it, check what
          it goes for on Kleinanzeigen, and tell you what to do with it.
        </p>

        <div className="mt-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p className="mb-4 text-center text-sm text-ink">
            Sign in with your Google account to continue.
          </p>
          <div className="flex justify-center" ref={buttonContainerRef} />
          <p className="mt-3 text-center text-xs text-muted">
            Only invited accounts can sign in.
          </p>

          {scriptLoadFailed && (
            <div
              className="mt-4 flex gap-2.5 rounded-xl bg-toss-soft px-3.5 py-3 text-sm text-toss"
              role="alert"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>
                Could not load Google Sign-In. Check your connection and reload
                the page.
              </p>
            </div>
          )}

          {errorMessage && (
            <div
              className="mt-4 flex gap-2.5 rounded-xl bg-toss-soft px-3.5 py-3 text-sm text-toss"
              role="alert"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>{errorMessage}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SignInPage

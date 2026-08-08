import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, GOOGLE_CLIENT_ID } from './api.js'
import { useAuth } from './AuthContext.jsx'

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

        const body = await result.json()
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
    <div className="max-w-lg mx-auto my-16 px-4 text-center">
      <h1 className="text-4xl md:text-5xl">Basement Declutter</h1>
      <p className="text-base text-text">
        Sign in with your Google account to photograph items, find
        comparable listings, and get a sell / give-away / throw-away
        recommendation.
      </p>

      <div className="mt-8 flex justify-center" ref={buttonContainerRef} />

      {scriptLoadFailed && (
        <div
          className="mt-4 px-4 py-3 rounded border border-throw-away-border bg-throw-away-bg text-throw-away-text"
          role="alert"
        >
          <p>
            Could not load Google Sign-In. Check your connection and reload
            the page.
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          className="mt-4 px-4 py-3 rounded border border-throw-away-border bg-throw-away-bg text-throw-away-text"
          role="alert"
        >
          <p>{errorMessage}</p>
        </div>
      )}
    </div>
  )
}

export default SignInPage

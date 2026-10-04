import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Camera } from './icons.jsx'
import { apiFetch } from './api.js'
import { prepareUploadImage } from './imageResize.js'

// Abort the upload request if it hasn't completed after this long, so a stalled
// mobile connection doesn't leave the page on "Uploading..." forever.
export const UPLOAD_TIMEOUT_MS = 60000

// Extracts a human-readable message from a failed fetch Response.
// The backend returns FastAPI-style `{"detail": "..."}` bodies for its
// 4xx/5xx errors; fall back to the status text if the body isn't JSON or
// doesn't have a `detail`.
async function extractErrorMessage(response) {
  try {
    const body = await response.json()
    if (body && typeof body.detail === 'string') {
      return body.detail
    }
  } catch {
    // Response body wasn't JSON -- fall through to the generic message.
  }
  return `Upload failed (${response.status} ${response.statusText})`
}

// The photo capture/upload page, rendered at `/`. On a successful upload
// this navigates to `/items/:id` (see App.jsx's routing-decision comment
// for why that's a separate route rather than inline state) so the user
// lands on the results page for the item they just created.
function UploadPage() {
  // 'idle' | 'preparing' | 'uploading' | 'error'
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [hint, setHint] = useState('')
  const fileInputRef = useRef(null)
  const navigate = useNavigate()
  const mountedRef = useRef(true)
  const controllerRef = useRef(null)
  const timerRef = useRef(null)

  // On unmount (e.g. navigating away mid-upload): cancel the in-flight
  // request and timer, and make handleFileChange skip any further state
  // updates. Setting true in the effect body keeps StrictMode remounts correct.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
      controllerRef.current?.abort()
    }
  }, [])

  const busy = status === 'preparing' || status === 'uploading'

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setStatus('preparing')
    setErrorMessage('')

    // Never throws; falls back to the original file.
    const prepared = await prepareUploadImage(file)
    if (!mountedRef.current) {
      return
    }

    setStatus('uploading')

    const formData = new FormData()
    formData.append('photo', prepared)
    formData.append('hint', hint)

    const controller = new AbortController()
    controllerRef.current = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, UPLOAD_TIMEOUT_MS)
    timerRef.current = timer

    // Clear the input so selecting the same file again fires onChange.
    function resetInput() {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    try {
      const response = await apiFetch('/items', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) {
        // A 401 here means the session expired while the user had this
        // page open (e.g. in a background tab) -- apiFetch (api.js) has
        // already cleared the stale token and dispatched
        // SESSION_EXPIRED_EVENT, which AuthContext listens for to flip the
        // app back to the sign-in gate on its next render. Show a message
        // that actually explains that, rather than treating it like an
        // unrelated upload failure (extractErrorMessage would otherwise
        // surface a generic/backend-authored "not authenticated"-style
        // string here).
        if (response.status === 401) {
          setErrorMessage('Your session has expired. Please sign in again.')
          setStatus('error')
          resetInput()
          return
        }
        const message = await extractErrorMessage(response)
        setErrorMessage(message)
        setStatus('error')
        resetInput()
        return
      }

      const data = await response.json()
      navigate(`/items/${data.id}`)
    } catch (err) {
      if (!mountedRef.current) {
        return
      }
      if (timedOut || err?.name === 'AbortError') {
        setErrorMessage(
          'Upload is taking too long -- check your connection and try again.',
        )
      } else {
        // Network error (backend unreachable, CORS failure, offline, etc.)
        // -- fetch rejects rather than resolving with a Response.
        setErrorMessage('Could not reach the server. Check your connection and try again.')
      }
      setStatus('error')
      resetInput()
    } finally {
      clearTimeout(timer)
    }
  }

  function handleReset() {
    setStatus('idle')
    setErrorMessage('')
    setHint('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">
        New item
      </p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        What did you find down there?
      </h1>
      <p className="mt-2 text-muted">
        Take a clear photo of one item. We&apos;ll handle the rest in about 20
        seconds.
      </p>

      {/* The label stays in the DOM while busy (visually hidden) so the
          input keeps an accessible name; the busy card replaces the zone. */}
      <label
        htmlFor="photo-input"
        className={
          busy
            ? 'sr-only'
            : 'group mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-surface px-6 py-12 text-center transition hover:border-primary hover:bg-primary-soft/40 has-[:focus-visible]:border-primary'
        }
      >
        {busy ? (
          status === 'uploading' ? 'Uploading...' : 'Preparing...'
        ) : (
          <>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-card transition group-hover:scale-105">
              <Camera size={26} />
            </span>
            <span className="mt-4 font-semibold">Take or choose a photo</span>
            <span className="mt-1 text-sm text-muted">
              On your phone this opens the camera
            </span>
          </>
        )}
      </label>
      <input
        id="photo-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={busy}
        aria-busy={busy}
        className="sr-only"
      />

      {busy && (
        <div
          className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
          role="status"
        >
          <div className="flex items-center gap-4 p-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-sunken text-muted">
              <Camera size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {status === 'uploading' ? 'Uploading photo…' : 'Preparing photo…'}
              </p>
              <p className="truncate text-sm text-muted">Hang tight, this takes a moment.</p>
            </div>
          </div>
          <div className="h-1 overflow-hidden bg-sunken">
            <div className="indeterminate h-full w-2/5 rounded-full bg-primary" />
          </div>
        </div>
      )}

      {status === 'error' && (
        <div
          className="mt-4 flex gap-2.5 rounded-xl bg-toss-soft px-3.5 py-3 text-sm text-toss"
          role="alert"
        >
          <AlertCircle
            size={16}
            className="mt-0.5 shrink-0"
          />
          <p className="flex-1">{errorMessage}</p>
          <button
            type="button"
            onClick={handleReset}
            className="shrink-0 self-start cursor-pointer rounded-lg bg-surface px-2.5 py-1 text-xs font-semibold text-ink shadow-card"
          >
            Try again
          </button>
        </div>
      )}

      <div className="mt-6">
        <label htmlFor="hint-input" className="text-sm font-semibold">
          Hint <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="hint-input"
          type="text"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="e.g. Bosch drill, orange casing"
          maxLength={500}
          disabled={busy}
          className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-muted">
          Brand, model, or anything the photo can&apos;t show.
        </p>
      </div>
    </div>
  )
}

export default UploadPage

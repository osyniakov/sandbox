import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Camera, Plus, Trash } from './icons.jsx'
import { apiFetch } from './api.js'
import { prepareUploadImage } from './imageResize.js'
import ItemPhoto from './ItemPhoto.jsx'
import { DECISION_LABELS, DECISION_PILL_CLASSES } from './itemsApi.js'

// Abort the upload request if it hasn't completed after this long, so a stalled
// mobile connection doesn't leave the page on "Uploading..." forever.
export const UPLOAD_TIMEOUT_MS = 60000

// Max photos per item (matches the backend limit).
export const MAX_PHOTOS = 10

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

// "Recently added" strip: the 3 newest items. Purely optional -- renders
// nothing while loading, on any failure, or with no items, and never blocks
// uploading. GET /items returns every item ordered by id ascending.
function RecentlyAdded() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await apiFetch('/items', { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        if (controller.signal.aborted || !Array.isArray(data)) return
        setItems([...data].sort((a, b) => b.id - a.id).slice(0, 3))
      } catch {
        // Optional strip: swallow errors (including abort).
      }
    })()
    return () => controller.abort()
  }, [])

  if (items.length === 0) return null

  return (
    <div className="mt-10 border-t border-line pt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Recently added</h2>
        <Link to="/inventory" className="text-sm font-medium text-primary hover:text-primary-hover">
          See all →
        </Link>
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-3">
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <Link to={`/items/${item.id}`} className="block min-w-0">
              <ItemPhoto item={item} className="aspect-square w-full" />
              <p className="mt-1.5 truncate text-sm font-medium">
                {item.identified_name || `Item #${item.id}`}
              </p>
              <span
                className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                  DECISION_PILL_CLASSES[item.decision] || DECISION_PILL_CLASSES.pending
                }`}
              >
                {DECISION_LABELS[item.decision] || item.decision}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
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
  // Tray of picked photos: [{ id, file, url }] (url = thumbnail object URL).
  // trayRef mirrors it so unmount cleanup and handlers see the latest value.
  const [tray, setTray] = useState([])
  const [notice, setNotice] = useState('')
  const trayRef = useRef([])
  const nextIdRef = useRef(1)
  const fileInputRef = useRef(null)
  const navigate = useNavigate()
  const mountedRef = useRef(true)
  const controllerRef = useRef(null)
  const timerRef = useRef(null)

  // On unmount (e.g. navigating away mid-upload): cancel the in-flight
  // request and timer, and make handleSubmit skip any further state
  // updates. Setting true in the effect body keeps StrictMode remounts correct.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
      controllerRef.current?.abort()
    }
  }, [])

  // Revoke every thumbnail URL still held when the page goes away.
  useEffect(() => {
    return () => {
      trayRef.current.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [])

  const busy = status === 'preparing' || status === 'uploading'
  const count = tray.length

  function updateTray(next) {
    trayRef.current = next
    setTray(next)
  }

  function resetInput() {
    // Clear the input so picking the same file again fires onChange.
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Appends the picked files to the tray (max MAX_PHOTOS total).
  function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    resetInput()
    if (files.length === 0 || busy) {
      return
    }
    const room = MAX_PHOTOS - trayRef.current.length
    const accepted = files.slice(0, Math.max(room, 0))
    setNotice(files.length > accepted.length ? `Up to ${MAX_PHOTOS} photos per item.` : '')
    if (accepted.length === 0) {
      return
    }
    const added = accepted.map((file) => ({
      id: nextIdRef.current++,
      file,
      url: URL.createObjectURL(file),
    }))
    updateTray([...trayRef.current, ...added])
    if (status === 'error') {
      setStatus('idle')
      setErrorMessage('')
    }
  }

  function handleRemove(id) {
    if (busy) {
      return
    }
    const removed = trayRef.current.find((p) => p.id === id)
    if (removed) {
      URL.revokeObjectURL(removed.url)
    }
    updateTray(trayRef.current.filter((p) => p.id !== id))
    setNotice('')
  }

  // Uploads the whole tray in one request. Also used by "Try again", which
  // re-submits the same tray.
  async function handleSubmit() {
    const photos = trayRef.current
    if (photos.length === 0 || busy) {
      return
    }

    setStatus('preparing')
    setErrorMessage('')
    setNotice('')

    // prepareUploadImage never throws; it falls back to the original file.
    const prepared = []
    for (const photo of photos) {
      prepared.push(await prepareUploadImage(photo.file))
      if (!mountedRef.current) {
        return
      }
    }

    setStatus('uploading')

    const formData = new FormData()
    prepared.forEach((file) => formData.append('photos', file))
    formData.append('hint', hint)

    const controller = new AbortController()
    controllerRef.current = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, UPLOAD_TIMEOUT_MS)
    timerRef.current = timer

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
        // that actually explains that, rather than a generic upload failure.
        if (response.status === 401) {
          setErrorMessage('Your session has expired. Please sign in again.')
          setStatus('error')
          return
        }
        const message = await extractErrorMessage(response)
        setErrorMessage(message)
        setStatus('error')
        return
      }

      const data = await response.json()
      // Uploaded: release the thumbnails before leaving the page.
      trayRef.current.forEach((p) => URL.revokeObjectURL(p.url))
      trayRef.current = []
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
    } finally {
      clearTimeout(timer)
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
        Take clear photos of one item, from a few angles if it helps. We&apos;ll handle the rest in about 20
        seconds.
      </p>

      {count > 0 && (
        <div className="mt-8">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-label="Selected photos">
            {tray.map((photo, index) => (
              <li key={photo.id} className="relative min-w-0">
                <img
                  src={photo.url}
                  alt={`Selected photo ${index + 1}`}
                  className="aspect-square w-full rounded-xl border border-line bg-sunken object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(photo.id)}
                  disabled={busy}
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute right-1.5 top-1.5 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-surface text-ink shadow-card hover:text-toss disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash size={14} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">
            {count} of {MAX_PHOTOS}
          </p>
        </div>
      )}

      {/* The label stays in the DOM while busy (visually hidden) so the
          input keeps an accessible name; the busy card replaces the zone. */}
      <label
        htmlFor="photo-input"
        className={
          busy
            ? 'sr-only'
            : count > 0
              ? 'mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold hover:border-primary hover:bg-primary-soft/40 has-[:focus-visible]:border-primary'
              : 'group mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-surface px-6 py-12 text-center transition hover:border-primary hover:bg-primary-soft/40 has-[:focus-visible]:border-primary'
        }
      >
        {busy ? (
          status === 'uploading' ? 'Uploading...' : 'Preparing...'
        ) : count > 0 ? (
          <>
            <Plus size={16} />
            Add more photos
          </>
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
        multiple
        onChange={handleFileChange}
        disabled={busy}
        aria-busy={busy}
        className="sr-only"
      />
      {notice && (
        <p className="mt-2 text-sm text-muted" role="note">
          {notice}
        </p>
      )}

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
                {status === 'uploading'
                  ? `Uploading ${count} ${count === 1 ? 'photo' : 'photos'}…`
                  : 'Preparing photos…'}
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
            onClick={handleSubmit}
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

      <button
        type="button"
        onClick={handleSubmit}
        disabled={count === 0 || busy}
        className="mt-6 w-full cursor-pointer rounded-full bg-primary px-5 py-3 font-semibold text-white shadow-card transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {count === 0 ? 'Upload photos' : `Upload ${count} ${count === 1 ? 'photo' : 'photos'}`}
      </button>

      <RecentlyAdded />
    </div>
  )
}

export default UploadPage

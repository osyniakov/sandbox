import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from './api.js'

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
  // 'idle' | 'uploading' | 'error'
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [hint, setHint] = useState('')
  const fileInputRef = useRef(null)
  const navigate = useNavigate()

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setStatus('uploading')
    setErrorMessage('')

    const formData = new FormData()
    formData.append('photo', file)
    formData.append('hint', hint)

    try {
      const response = await fetch(`${API_BASE_URL}/items`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const message = await extractErrorMessage(response)
        setErrorMessage(message)
        setStatus('error')
        return
      }

      const data = await response.json()
      navigate(`/items/${data.id}`)
    } catch {
      // Network error (backend unreachable, CORS failure, offline, etc.)
      // -- fetch rejects rather than resolving with a Response.
      setErrorMessage('Could not reach the server. Check your connection and try again.')
      setStatus('error')
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
    <div className="max-w-lg mx-auto my-16 px-4 text-center">
      <h1 className="text-4xl md:text-5xl">Basement Declutter</h1>
      <p className="text-base text-text">
        Photograph an item, find comparable listings, and get a sell /
        give-away / throw-away recommendation.
      </p>

      <p className="mt-4">
        <Link to="/inventory" className="link">
          View basement inventory
        </Link>
      </p>

      <label
        htmlFor="hint-input"
        className="block mt-6 mb-2 font-semibold text-heading"
      >
        Hint (optional)
      </label>
      <input
        id="hint-input"
        type="text"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        placeholder="e.g. Bosch drill, orange casing"
        maxLength={500}
        disabled={status === 'uploading'}
        className="form-input mx-auto disabled:opacity-60 disabled:cursor-not-allowed"
      />

      <label
        htmlFor="photo-input"
        className="block mt-6 mb-2 font-semibold text-heading"
      >
        {status === 'uploading' ? 'Uploading...' : 'Take or choose a photo'}
      </label>
      <input
        id="photo-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={status === 'uploading'}
        aria-busy={status === 'uploading'}
        className="form-file mx-auto disabled:opacity-60 disabled:cursor-not-allowed"
      />

      {status === 'uploading' && (
        <p className="mt-6 text-sm italic text-text" role="status">
          Uploading photo...
        </p>
      )}

      {status === 'error' && (
        <div
          className="mt-4 px-4 py-3 rounded border border-throw-away-border bg-throw-away-bg text-throw-away-text"
          role="alert"
        >
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-2 rounded border border-border bg-bg px-3 py-1.5 text-sm font-medium text-text cursor-pointer hover:bg-primary-hover/10 hover:border-primary"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

export default UploadPage

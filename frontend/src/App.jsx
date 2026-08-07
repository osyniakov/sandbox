import { useRef, useState } from 'react'
import './App.css'

// Configurable via a Vite env var so the frontend can be pointed at a
// different backend (e.g. a docker-compose service name, or a deployed
// host) without code changes. See `.env.example`.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

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

function App() {
  // 'idle' | 'uploading' | 'success' | 'error'
  const [status, setStatus] = useState('idle')
  const [itemId, setItemId] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const fileInputRef = useRef(null)

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setStatus('uploading')
    setErrorMessage('')

    const formData = new FormData()
    formData.append('photo', file)

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
      setItemId(data.id)
      setStatus('success')
    } catch {
      // Network error (backend unreachable, CORS failure, offline, etc.)
      // -- fetch rejects rather than resolving with a Response.
      setErrorMessage('Could not reach the server. Check your connection and try again.')
      setStatus('error')
    }
  }

  function handleReset() {
    setStatus('idle')
    setItemId(null)
    setErrorMessage('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="placeholder">
      <h1>Basement Declutter</h1>
      <p>
        Photograph an item, find comparable listings, and get a sell /
        give-away / throw-away recommendation.
      </p>

      {status === 'success' ? (
        <div className="processing" role="status">
          <p>
            Item #{itemId} — processing...
          </p>
          <button type="button" onClick={handleReset}>
            Upload another photo
          </button>
        </div>
      ) : (
        <>
          <label htmlFor="photo-input" className="photo-input-label">
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
          />

          {status === 'uploading' && (
            <p className="status" role="status">
              Uploading photo...
            </p>
          )}

          {status === 'error' && (
            <div className="error" role="alert">
              <p>{errorMessage}</p>
              <button type="button" onClick={handleReset}>
                Try again
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default App

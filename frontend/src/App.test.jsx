import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { SESSION_TOKEN_STORAGE_KEY } from './api.js'

// App.jsx is now an auth gate (sandbox-dfr.4) wrapping the router root
// (see App.jsx's routing-decision comment for the pre-existing routing
// write-up): unauthenticated visitors see `SignInPage` instead of the
// routed app; authenticated visitors see the app exactly as before. The
// upload-flow/results-page assertions themselves still live in
// UploadPage.test.jsx/ItemResultPage.test.jsx -- this stays a thin smoke
// test confirming the gate + router wiring.
describe('App auth gate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('renders the sign-in page, not the routed app, when unauthenticated', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: /basement declutter/i })).toBeInTheDocument()
    expect(screen.getByText(/sign in with your google account/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/take or choose a photo/i)).not.toBeInTheDocument()
    // No token stored -- /auth/me must not have been called.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders the routed app (upload flow at "/"), not the sign-in page, when authenticated', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: 'user@example.com' }),
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByLabelText(/take or choose a photo/i)).toBeInTheDocument()
    })

    expect(
      screen.queryByText(/sign in with your google account/i),
    ).not.toBeInTheDocument()
  })
})

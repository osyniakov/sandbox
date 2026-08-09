import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import SignInPage from './SignInPage.jsx'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import { API_BASE_URL, SESSION_TOKEN_STORAGE_KEY } from './api.js'

// Exposes AuthContext's post-sign-in state so tests can assert
// `completeSignIn` was actually invoked with the right values, not just
// that `localStorage` was written to.
function AuthProbe() {
  const { email, isAuthenticated } = useAuth()
  return (
    <p data-testid="auth-state">
      {isAuthenticated ? `authenticated:${email}` : 'unauthenticated'}
    </p>
  )
}

function renderSignInPage() {
  return render(
    <AuthProvider>
      <SignInPage />
      <AuthProbe />
    </AuthProvider>,
  )
}

// jsdom has no real Google Identity Services -- stub the pieces
// SignInPage calls, capturing the `callback` GIS would normally invoke
// itself (with a real Google-issued credential) so tests can trigger it
// directly to simulate a completed Google sign-in.
function stubGoogleIdentityServices() {
  let capturedCallback
  const initialize = vi.fn(({ callback }) => {
    capturedCallback = callback
  })
  const renderButton = vi.fn()
  window.google = { accounts: { id: { initialize, renderButton } } }
  return {
    initialize,
    renderButton,
    triggerCredentialResponse: (response) => capturedCallback(response),
  }
}

describe('SignInPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    delete window.google
    cleanup()
  })

  it('initializes Google Identity Services and renders the button container once window.google is available', async () => {
    const gis = stubGoogleIdentityServices()
    renderSignInPage()

    await waitFor(() => {
      expect(gis.initialize).toHaveBeenCalledTimes(1)
    })
    expect(gis.renderButton).toHaveBeenCalledTimes(1)
  })

  it('a successful sign-in stores the token and updates the auth context', async () => {
    const gis = stubGoogleIdentityServices()
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'session-token-abc', email: 'user@example.com' }),
    })

    renderSignInPage()

    await waitFor(() => {
      expect(gis.initialize).toHaveBeenCalledTimes(1)
    })

    await gis.triggerCredentialResponse({ credential: 'fake-google-id-token' })

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent(
        'authenticated:user@example.com',
      )
    })

    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('session-token-abc')

    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(`${API_BASE_URL}/auth/google`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ id_token: 'fake-google-id-token' })
  })

  it('a failed (401) sign-in shows an error message and stores nothing', async () => {
    const gis = stubGoogleIdentityServices()
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'not-whitelisted@example.com is not authorized.' }),
    })

    renderSignInPage()

    await waitFor(() => {
      expect(gis.initialize).toHaveBeenCalledTimes(1)
    })

    await gis.triggerCredentialResponse({ credential: 'fake-google-id-token' })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not authorized/i)
    })

    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated')
  })

  it('shows a load-failure message if window.google never becomes available', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Deliberately do NOT stub window.google for this test.
    renderSignInPage()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100)
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/could not load google sign-in/i)

    vi.useRealTimers()
  })
})

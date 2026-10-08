import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import { getPhotoBlob, peekPhotoBlob } from './photoBlobCache.js'
import { SESSION_EXPIRED_EVENT, SESSION_TOKEN_STORAGE_KEY } from './api.js'

// A minimal consumer that surfaces AuthContext's state/methods as text/
// buttons, so these tests can assert on rendered output rather than
// reaching into React internals.
function AuthProbe() {
  const { email, isAuthenticated, isLoading, signOut, completeSignIn } = useAuth()
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="authenticated">{String(isAuthenticated)}</p>
      <p data-testid="email">{email ?? ''}</p>
      <button onClick={() => completeSignIn('new-token', 'new@example.com')}>
        sign in
      </button>
      <button onClick={() => signOut()}>sign out</button>
    </div>
  )
}

function renderAuthProbe() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('with no stored token, isAuthenticated is false once loading settles', async () => {
    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(screen.getByTestId('email')).toHaveTextContent('')
    // No token to validate -- /api/auth/me must not have been called.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('with a stored token that /api/auth/me confirms is valid, becomes authenticated with the right email', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: 'existing@example.com' }),
    })

    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    expect(screen.getByTestId('email')).toHaveTextContent('existing@example.com')

    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('/api/auth/me')
    expect(options.headers.Authorization).toBe('Bearer valid-token')
  })

  it('with a stored token that /api/auth/me rejects with 401, stays unauthenticated and clears the token', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'stale-token')
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid or expired session token.' }),
    })

    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(screen.getByTestId('email')).toHaveTextContent('')
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('completeSignIn stores the token and flips to authenticated', async () => {
    const user = userEvent.setup()
    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    await user.click(screen.getByRole('button', { name: 'sign in' }))

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    expect(screen.getByTestId('email')).toHaveTextContent('new@example.com')
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('new-token')
  })

  it('signOut calls /api/auth/logout best-effort, clears the token, and reverts to unauthenticated', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ email: 'existing@example.com' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })

    const user = userEvent.setup()
    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    })

    await user.click(screen.getByRole('button', { name: 'sign out' }))

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('email')).toHaveTextContent('')
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()

    const [logoutUrl, logoutOptions] = fetch.mock.calls[1]
    expect(logoutUrl).toContain('/api/auth/logout')
    expect(logoutOptions.method).toBe('POST')
  })

  it('signOut still clears local state even if the /api/auth/logout call fails', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ email: 'existing@example.com' }),
      })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const user = userEvent.setup()
    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    })

    await user.click(screen.getByRole('button', { name: 'sign out' }))

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    })

    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('reacts to a mid-session auth:session-expired event by reverting to unauthenticated', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: 'existing@example.com' }),
    })

    renderAuthProbe()

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    })

    // Simulate apiFetch (api.js) discovering a dead session elsewhere in
    // the app and dispatching the event -- it would already have cleared
    // localStorage itself before dispatching, so this test mirrors that.
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    })

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(screen.getByTestId('email')).toHaveTextContent('')
  })

  async function seedPhotoAndAuth(logoutResult) {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) })
    await getPhotoBlob('/api/uploads/a.png')
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeDefined()
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ email: 'e@example.com' }) })
    if (logoutResult) fetch.mockImplementationOnce(logoutResult)
    renderAuthProbe()
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    })
  }

  it('signOut empties the photo blob cache', async () => {
    await seedPhotoAndAuth(() => Promise.resolve({ ok: true, status: 200 }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }))
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'))
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
  })

  it('signOut empties the photo blob cache even if /api/auth/logout fails', async () => {
    await seedPhotoAndAuth(() => Promise.reject(new TypeError('Failed to fetch')))
    await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }))
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'))
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
  })

  it('a session-expired event empties the photo blob cache', async () => {
    await seedPhotoAndAuth()
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    })
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
  })

  it('a rejected /api/auth/me on mount empties the photo blob cache', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) })
    await getPhotoBlob('/api/uploads/a.png')
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'stale')
    fetch.mockResolvedValueOnce({ ok: false, status: 401 })
    renderAuthProbe()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
  })
})

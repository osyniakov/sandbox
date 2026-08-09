import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignOutControl from './SignOutControl.jsx'
import { AuthProvider } from './AuthContext.jsx'
import { SESSION_TOKEN_STORAGE_KEY } from './api.js'

// Renders SignOutControl inside a real AuthProvider (rather than a fake
// context value) so this exercises the actual `useAuth()` contract it
// depends on -- mirrors AuthContext.test.jsx's own conventions.
function renderSignedIn() {
  localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ email: 'signed-in@example.com' }),
  })

  return render(
    <AuthProvider>
      <SignOutControl />
    </AuthProvider>,
  )
}

describe('SignOutControl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('shows the signed-in email and a reachable "Sign out" button', async () => {
    renderSignedIn()

    await waitFor(() => {
      expect(screen.getByText(/signed-in@example\.com/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('clicking "Sign out" clears the session (calls /auth/logout and removes the stored token)', async () => {
    const user = userEvent.setup()
    renderSignedIn()

    await waitFor(() => {
      expect(screen.getByText(/signed-in@example\.com/i)).toBeInTheDocument()
    })

    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
    })

    const [logoutUrl, logoutOptions] = fetch.mock.calls[1]
    expect(logoutUrl).toContain('/auth/logout')
    expect(logoutOptions.method).toBe('POST')
  })
})

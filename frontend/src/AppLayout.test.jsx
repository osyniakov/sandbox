import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppLayout from './AppLayout.jsx'
import { AuthProvider } from './AuthContext.jsx'
import { SESSION_TOKEN_STORAGE_KEY } from './api.js'

// Renders AppLayout inside a real AuthProvider (rather than a fake context
// value) so this exercises the actual `useAuth()` contract it depends on.
async function renderLayout(initialPath = '/') {
  localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'valid-token')
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ email: 'jane.doe@example.com' }),
  })

  const utils = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<p>upload page</p>} />
            <Route path="/inventory" element={<p>inventory page</p>} />
            <Route path="/items/:id" element={<p>item page</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  await screen.findByText(/^JD$/)
  return utils
}

describe('AppLayout', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('renders the routed page, the logo link and nav links', async () => {
    await renderLayout('/')
    expect(screen.getByText('upload page')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /basement declutter/i })).toHaveAttribute('href', '/')
    // Desktop nav and mobile tab bar both render in jsdom.
    expect(screen.getAllByRole('link', { name: /add item/i })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /inventory/i })).toHaveLength(2)
  })

  it('marks Inventory active on /inventory and /items/:id, Add item on /', async () => {
    await renderLayout('/')
    screen.getAllByRole('link', { name: /add item/i }).forEach((link) => {
      expect(link).toHaveAttribute('aria-current', 'page')
    })
    cleanup()

    await renderLayout('/items/7')
    screen.getAllByRole('link', { name: /inventory/i }).forEach((link) => {
      expect(link.className).toMatch(/text-primary/)
    })
    screen.getAllByRole('link', { name: /add item/i }).forEach((link) => {
      expect(link).not.toHaveAttribute('aria-current')
    })
  })

  it('shows initials on a closed account menu, then email and Sign out once opened', async () => {
    const user = userEvent.setup()
    await renderLayout()

    const button = screen.getByRole('button', { name: 'Account menu' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toHaveTextContent('Signed in as jane.doe@example.com')
    expect(screen.getByText('jane.doe@example.com')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  })

  it('closes the menu on Escape and on outside click', async () => {
    const user = userEvent.setup()
    await renderLayout()
    const button = screen.getByRole('button', { name: 'Account menu' })

    await user.click(button)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByText('upload page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu on route change', async () => {
    const user = userEvent.setup()
    await renderLayout()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /inventory/i })[0])
    expect(screen.getByText('inventory page')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking "Sign out" clears the session (calls /api/auth/logout and removes the stored token)', async () => {
    const user = userEvent.setup()
    await renderLayout()

    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: /sign out/i }))

    await waitFor(() => {
      expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
    })

    const [logoutUrl, logoutOptions] = fetch.mock.calls[1]
    expect(logoutUrl).toContain('/api/auth/logout')
    expect(logoutOptions.method).toBe('POST')
  })
})

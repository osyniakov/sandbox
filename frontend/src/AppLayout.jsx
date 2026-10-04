import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, matchPath, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { Box, Camera, ChevronDown, LogOut } from './icons.jsx'

// Authenticated app shell (sandbox-2pc.2): sticky top bar with the logo, the
// desktop nav and an account menu (sign-out lives here), a mobile bottom tab
// bar, and the routed page via <Outlet/>.

function initialsFromEmail(email) {
  if (!email) return '?'
  const local = email.split('@')[0] || ''
  const parts = local.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters =
    parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)
  return letters.toUpperCase()
}

function AccountMenu() {
  const { email, signOut } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  // Close on route change.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Close on Escape and on outside press while open.
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onPointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  return (
    <div className="relative ml-auto" ref={containerRef}>
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-sunken"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink">
          {initialsFromEmail(email)}
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-card"
        >
          <p className="px-3 py-2 text-xs text-muted">
            Signed in as{' '}
            <br />
            <span className="break-all text-sm font-medium text-ink">{email}</span>
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function AppLayout() {
  const { pathname } = useLocation()
  // "/items/:id" belongs to the Inventory section.
  const inventoryActive =
    pathname === '/inventory' || matchPath('/items/:id', pathname) !== null

  const desktopLink = (active) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      active ? 'bg-primary-soft text-primary' : 'text-muted hover:text-ink'
    }`
  const tabLink = (active) =>
    `flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
      active ? 'text-primary' : 'text-muted'
    }`

  return (
    <div className="min-h-svh bg-ground text-ink">
      <header
        className="sticky z-20 border-b border-line bg-surface/90 backdrop-blur"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-white">
              <Box size={18} />
            </span>
            <span className="font-display font-bold tracking-tight">
              Basement Declutter
            </span>
          </Link>
          <nav className="hidden gap-1 sm:flex" aria-label="Main">
            <NavLink to="/" end className={({ isActive }) => desktopLink(isActive)}>
              Add item
            </NavLink>
            <NavLink to="/inventory" className={() => desktopLink(inventoryActive)}>
              Inventory
            </NavLink>
          </nav>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-6 pb-28 sm:pt-10 sm:pb-16">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Main"
      >
        <div className="mx-auto grid max-w-md grid-cols-2">
          <NavLink to="/" end className={({ isActive }) => tabLink(isActive)}>
            <Camera size={22} />
            Add item
          </NavLink>
          <NavLink to="/inventory" className={() => tabLink(inventoryActive)}>
            <Box size={22} />
            Inventory
          </NavLink>
        </div>
      </nav>
    </div>
  )
}

export default AppLayout

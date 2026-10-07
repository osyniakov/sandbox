import { BrowserRouter, Route, Routes } from 'react-router-dom'
import UploadPage from './UploadPage.jsx'
import ItemResultPage from './ItemResultPage.jsx'
import InventoryPage from './InventoryPage.jsx'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import AppLayout from './AppLayout.jsx'
import SignInPage from './SignInPage.jsx'

// Routing decision (sandbox-yqf.10)
// ----------------------------------
// This bead's brief flagged that a future bead (sandbox-yqf.11, the
// basement inventory list) will need to deep-link users to a specific
// item's results, so this introduces a proper URL-addressable route per
// item (`/items/:id`) via `react-router-dom` rather than folding the
// results view into App.jsx's old single-page capture/upload state
// machine (which only ever had one "screen" and no shareable/refreshable
// URL per item). Concretely:
//
//   `/`           -- the photo capture/upload flow (`UploadPage.jsx`,
//                    the pre-existing sandbox-yqf.5 flow, split out
//                    verbatim aside from navigating instead of showing
//                    an inline "processing" message on success).
//   `/items/:id`  -- the new results view (`ItemResultPage.jsx`), which
//                    fetches + polls `GET /api/items/{id}` and is safe to
//                    deep-link/refresh directly (e.g. from a future
//                    inventory list, or a bookmarked/shared URL).
//
// `App.jsx` itself is now just the router root (BrowserRouter + Routes),
// not a page component -- this keeps each page's state/effects scoped to
// its own component and matches the mental model sandbox-yqf.11 will
// want ("render the results page for item N" is just a navigation to
// `/items/N`, not a prop threaded through shared page state).
//
// `/inventory` (sandbox-yqf.11) -- the basement inventory list
// (`InventoryPage.jsx`): every item, filterable by status/decision, with
// controls to manually advance an item's status once the user has acted
// on it outside the app (listed/given away/disposed).
//
// `react-router-dom` (not e.g. a hand-rolled `window.location`/hash
// router) was chosen because it's the de facto standard for this in the
// React ecosystem, has first-class support for the `useParams`/
// `useNavigate` hooks used here, and needs no build/server configuration
// changes beyond what Vite already does (client-side routing only --
// there's no SSR here to worry about).
// Shared layout (sandbox-2pc.2): every authenticated route renders inside
// AppLayout (top bar, mobile tabs, account menu) via a layout route.
// Auth gate (sandbox-dfr.4): wraps the routed app in `AuthProvider` and
// decides what to render based on its state --
//   - `isLoading` (the initial `GET /api/auth/me` validation of any stored
//     token, see AuthContext.jsx): a minimal loading state, so an
//     already-signed-in visitor doesn't see the sign-in page flash
//     before immediately flipping to the app.
//   - not `isAuthenticated`: `SignInPage` instead of the routed app --
//     unauthenticated visitors see the sign-in gate and nothing else.
//   - `isAuthenticated`: the routed app exactly as before this bead (the
//     three `<Route>` entries below are unchanged).
function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth()

  if (isLoading) {
    return (
      <div className="grid min-h-svh place-items-center bg-ground px-4 text-center">
        <p className="text-base text-muted" role="status">
          Loading...
        </p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <SignInPage />
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<UploadPage />} />
        <Route path="/items/:id" element={<ItemResultPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

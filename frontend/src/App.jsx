import { BrowserRouter, Route, Routes } from 'react-router-dom'
import UploadPage from './UploadPage.jsx'
import ItemResultPage from './ItemResultPage.jsx'
import InventoryPage from './InventoryPage.jsx'

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
//                    fetches + polls `GET /items/{id}` and is safe to
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
// Shared layout wrapper: deliberately NOT introduced here (sandbox-zlt.6).
// index.css's plain-CSS `#root` rule (see sandbox-zlt.2) already gives
// every routed page a single, consistent page container -- fixed
// max-width, centered, border-inline, min-height: 100svh -- applied by
// selector, not by JSX nesting, so it doesn't matter that each page
// component (UploadPage/ItemResultPage/InventoryPage) renders its own
// top-level element directly rather than being wrapped in a shared
// `<Layout>` here. Adding a second JSX-level wrapper (e.g. a
// `max-w-*`/`px-*` div around `<Routes>`) would duplicate that container
// and risk double padding or a conflicting box model against whatever
// each page independently adopts, especially since sandbox-zlt.3/.4/.5
// are restyling those three pages in parallel and may not agree yet on
// their own root element's classes. If a later task retires the
// plain-CSS `#root` rule (sandbox-zlt.9, App.css itself was removed by
// sandbox-zlt.7 since it had gone fully dead), that's the point to
// introduce a real Tailwind-based `<Layout>` wrapper here instead of
// resurrecting it prematurely now.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/items/:id" element={<ItemResultPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

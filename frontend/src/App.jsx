import { BrowserRouter, Route, Routes } from 'react-router-dom'
import UploadPage from './UploadPage.jsx'
import ItemResultPage from './ItemResultPage.jsx'
import './App.css'

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
// `react-router-dom` (not e.g. a hand-rolled `window.location`/hash
// router) was chosen because it's the de facto standard for this in the
// React ecosystem, has first-class support for the `useParams`/
// `useNavigate` hooks used here, and needs no build/server configuration
// changes beyond what Vite already does (client-side routing only --
// there's no SSR here to worry about).
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/items/:id" element={<ItemResultPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

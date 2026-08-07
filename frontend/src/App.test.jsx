import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'

// App.jsx is now just the router root (see its module docstring for the
// full routing decision write-up). The upload-flow assertions that used
// to live here (sandbox-yqf.5) now live in UploadPage.test.jsx, since
// that's the component that actually owns that behavior; the results-page
// assertions (sandbox-yqf.10) live in ItemResultPage.test.jsx. This is a
// thin smoke test confirming the router wiring itself still works: `App`
// (which renders its own `BrowserRouter`, defaulting to `/`) renders the
// upload page at the root route.
describe('App routing', () => {
  it('renders the upload flow at the root route', () => {
    render(<App />)
    expect(screen.getByLabelText(/take or choose a photo/i)).toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import UploadPage from './UploadPage.jsx'

// A minimal in-memory "fixture" image file, standing in for a real photo
// selected via the camera-capture/file-picker input.
function makeFixtureImageFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], 'fixture-photo.jpg', {
    type: 'image/jpeg',
  })
}

// A stand-in for the real `/items/:id` route (`ItemResultPage`, tested
// separately in ItemResultPage.test.jsx) so these tests can assert
// UploadPage navigates to the right URL on success without also having
// to mock ItemResultPage's own `GET /items/{id}` polling fetch.
function ItemIdProbe() {
  const { id } = useParams()
  return <p>Item #{id}</p>
}

function renderUploadPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/items/:id" element={<ItemIdProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UploadPage photo capture/upload flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('uploads the selected photo and navigates to the item results page on success', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await user.upload(input, file)

    // While the request is in flight, the input is disabled (prevents
    // duplicate submissions) and a loading indicator is shown.
    expect(input).toBeDisabled()

    // On success, UploadPage navigates to `/items/42` (see App.jsx's
    // routing-decision comment) rather than showing an inline "Item #42
    // — processing..." message itself; the target route renders the
    // item id, confirming the navigation actually happened with the
    // right id.
    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('/items')
    expect(options.method).toBe('POST')
    // The multipart field name must match what the backend expects
    // (`photo`, per backend/app/main.py's `create_item`).
    expect(options.body.get('photo')).toBe(file)
  })

  it('shows a visible error message when the upload fails (network error)', async () => {
    const user = userEvent.setup()
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    await user.upload(input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i)
    })

    // The input is re-enabled after the failure so the user can retry.
    expect(input).not.toBeDisabled()
  })

  it('shows a visible error message when the backend returns a 4xx response', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ detail: 'Uploaded file is empty.' }),
    })

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    await user.upload(input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/uploaded file is empty/i)
    })
  })
})

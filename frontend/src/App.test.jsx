import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

// A minimal in-memory "fixture" image file, standing in for a real photo
// selected via the camera-capture/file-picker input.
function makeFixtureImageFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], 'fixture-photo.jpg', {
    type: 'image/jpeg',
  })
}

describe('App photo capture/upload page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('uploads the selected photo and shows the returned item id on success', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    render(<App />)

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await user.upload(input, file)

    // While the request is in flight, the input is disabled (prevents
    // duplicate submissions) and a loading indicator is shown.
    expect(input).toBeDisabled()

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

    render(<App />)

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

    render(<App />)

    const input = screen.getByLabelText(/take or choose a photo/i)
    await user.upload(input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/uploaded file is empty/i)
    })
  })
})

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

  it('updates the displayed hint value as the user types', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    const hintInput = screen.getByLabelText(/hint \(optional\)/i)
    await user.type(hintInput, 'Bosch drill, orange casing')

    expect(hintInput).toHaveValue('Bosch drill, orange casing')
  })

  it('includes the typed hint in the upload FormData', async () => {
    const user = userEvent.setup()
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    renderUploadPage()

    const hintInput = screen.getByLabelText(/hint \(optional\)/i)
    await user.type(hintInput, 'Bosch drill, orange casing')

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, options] = fetch.mock.calls[0]
    expect(options.body.get('hint')).toBe('Bosch drill, orange casing')
  })

  it('still uploads successfully when no hint is typed (hint is optional)', async () => {
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

    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, options] = fetch.mock.calls[0]
    expect(options.body.get('photo')).toBe(file)
    expect(options.body.get('hint')).toBe('')
  })

  it('disables the hint input while the upload is in flight', async () => {
    const user = userEvent.setup()

    let resolveFetch
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    fetch.mockReturnValueOnce(fetchPromise)

    renderUploadPage()

    const hintInput = screen.getByLabelText(/hint \(optional\)/i)
    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await user.upload(input, file)

    expect(hintInput).toBeDisabled()

    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })
  })

  it('clears the hint field on reset after an error', async () => {
    const user = userEvent.setup()
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderUploadPage()

    const hintInput = screen.getByLabelText(/hint \(optional\)/i)
    await user.type(hintInput, 'Bosch drill, orange casing')

    const input = screen.getByLabelText(/take or choose a photo/i)
    await user.upload(input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i)
    })

    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByLabelText(/hint \(optional\)/i)).toHaveValue('')
  })

  it('disables the input while the upload is genuinely in flight, then navigates once it resolves', async () => {
    const user = userEvent.setup()

    // A deferred/controllable mock fetch: the promise it returns stays
    // pending until this test explicitly calls `resolveFetch`, so the
    // in-flight assertions below observe the *live* DOM state while the
    // request is actually still outstanding, rather than a stale
    // last-rendered attribute captured after the request already resolved.
    let resolveFetch
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    fetch.mockReturnValueOnce(fetchPromise)

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await user.upload(input, file)

    // The fetch promise is still pending at this point (we haven't called
    // resolveFetch yet), so this genuinely proves the input is disabled
    // *while* the request is in flight, and a loading indicator is shown.
    expect(input).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/uploading photo/i)
    expect(fetch).toHaveBeenCalledTimes(1)

    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    // Once the request resolves, UploadPage navigates to `/items/42`
    // (unmounting the upload form) rather than re-enabling the input in
    // place.
    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not fire a second fetch if the input is interacted with again while a request is already in flight', async () => {
    const user = userEvent.setup()

    let resolveFetch
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    fetch.mockReturnValueOnce(fetchPromise)

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await user.upload(input, file)

    // Request is still pending -- input should be disabled, blocking a
    // second selection.
    expect(input).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)

    // Attempt a second file selection while the first request is still in
    // flight. `user.upload` is a no-op on a disabled input (mirrors real
    // browser behavior), so this must not trigger a second fetch call.
    await user.upload(input, makeFixtureImageFile())

    expect(fetch).toHaveBeenCalledTimes(1)

    // Clean up: resolve the outstanding request so it doesn't leak into
    // other tests / cause act() warnings.
    resolveFetch({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })
    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })
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

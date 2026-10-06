import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import UploadPage, { UPLOAD_TIMEOUT_MS } from './UploadPage.jsx'
import { prepareUploadImage } from './imageResize.js'
import { AuthProvider } from './AuthContext.jsx'

// A minimal in-memory "fixture" image file, standing in for a real photo
// selected via the camera-capture/file-picker input.
// Default: pass the file through; individual tests override.
vi.mock('./imageResize.js', () => ({
  prepareUploadImage: vi.fn(async (file) => file),
}))

// jsdom has no URL.createObjectURL; stub it so thumbnails can render and the
// tests can assert URLs are revoked.
let revokeSpy
beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:thumb-${++n}`)
  revokeSpy = vi.fn()
  URL.revokeObjectURL = revokeSpy
})

// Picking a photo no longer uploads: add it to the tray, then press Upload.
async function addAndSubmit(user, input, files) {
  await user.upload(input, files)
  const button = screen.getByRole('button', { name: /upload \d+ photos?/i })
  await user.click(button)
}

function makeFixtureImageFile(name = 'fixture-photo.jpg') {
  return new File([new Uint8Array([1, 2, 3, 4])], name, {
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

// Wrapped in AuthProvider (sandbox-dfr.5) since UploadPage now renders
// SignOutControl, which reads useAuth(). No token is ever stored in these
// tests, so AuthProvider's mount check settles synchronously to
// unauthenticated/no-email WITHOUT calling `fetch` itself (see
// AuthContext.jsx) -- this keeps every existing `fetch`-call-count
// assertion below accurate (only UploadPage's own apiFetch call, never an
// extra `/auth/me` call).
function renderUploadPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/items/:id" element={<ItemIdProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

// fetch is routed by URL/method: the "Recently added" strip's GET /items goes
// to `itemsFetch` (default: empty list), everything else (the upload POST) to
// `uploadFetch`, so the upload tests' call-order/count assumptions are unchanged.
let uploadFetch
let itemsFetch
function installFetch() {
  uploadFetch = vi.fn()
  itemsFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
  vi.stubGlobal('fetch', (url, options = {}) =>
    url.endsWith('/items') && (options.method || 'GET') === 'GET'
      ? itemsFetch(url, options)
      : uploadFetch(url, options),
  )
}

describe('UploadPage photo capture/upload flow', () => {
  beforeEach(() => {
    installFetch()
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  // Regression test for sandbox-7i6: a `capture` attribute on this input
  // (e.g. `capture="environment"`) makes iOS Safari (and most mobile
  // browsers) skip the normal file-picker sheet and jump straight into the
  // camera, with no way to choose an existing photo from the library.
  // `accept="image/*"` alone is enough to let the native picker offer both
  // options -- `capture` must never be reintroduced here.
  it('does not set a `capture` attribute on the photo input (would force the camera open on mobile)', () => {
    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    expect(input).not.toHaveAttribute('capture')
  })

  it('uploads the selected photo and navigates to the item results page on success', async () => {
    const user = userEvent.setup()
    uploadFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await addAndSubmit(user, input, file)

    // On success, UploadPage navigates to `/items/42` (see App.jsx's
    // routing-decision comment) rather than showing an inline "Item #42
    // — processing..." message itself; the target route renders the
    // item id, confirming the navigation actually happened with the
    // right id.
    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(uploadFetch).toHaveBeenCalledTimes(1)
    const [url, options] = uploadFetch.mock.calls[0]
    expect(url).toContain('/items')
    expect(options.method).toBe('POST')
    // The multipart field name must match what the backend expects
    // (repeated `photos`, per backend/app/main.py's `create_item`).
    expect(options.body.getAll('photos')).toEqual([file])
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
    uploadFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    renderUploadPage()

    const hintInput = screen.getByLabelText(/hint \(optional\)/i)
    await user.type(hintInput, 'Bosch drill, orange casing')

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()
    await addAndSubmit(user, input, file)

    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(uploadFetch).toHaveBeenCalledTimes(1)
    const [, options] = uploadFetch.mock.calls[0]
    expect(options.body.get('hint')).toBe('Bosch drill, orange casing')
  })

  it('still uploads successfully when no hint is typed (hint is optional)', async () => {
    const user = userEvent.setup()
    uploadFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, status: 'pending_identification', photo_path: '/x' }),
    })

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()
    await addAndSubmit(user, input, file)

    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })

    expect(uploadFetch).toHaveBeenCalledTimes(1)
    const [, options] = uploadFetch.mock.calls[0]
    expect(options.body.getAll('photos')).toEqual([file])
    expect(options.body.get('hint')).toBe('')
  })

  it('disables the hint input while the upload is in flight', async () => {
    const user = userEvent.setup()

    let resolveFetch
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    uploadFetch.mockReturnValueOnce(fetchPromise)

    renderUploadPage()

    const hintInput = screen.getByLabelText(/hint \(optional\)/i)
    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await addAndSubmit(user, input, file)

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

  it('keeps the hint and the tray after an error, and Try again re-submits the same tray', async () => {
    const user = userEvent.setup()
    uploadFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    uploadFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 42 }) })

    renderUploadPage()

    await user.type(screen.getByLabelText(/hint \(optional\)/i), 'Bosch drill')
    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()
    await addAndSubmit(user, input, file)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i)
    })
    expect(screen.getByLabelText(/hint \(optional\)/i)).toHaveValue('Bosch drill')
    expect(screen.getByRole('button', { name: 'Upload 1 photo' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.getByText(/item #42/i)).toBeInTheDocument())
    expect(uploadFetch).toHaveBeenCalledTimes(2)
    const body = uploadFetch.mock.calls[1][1].body
    expect(body.getAll('photos')).toEqual([file])
    expect(body.get('hint')).toBe('Bosch drill')
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
    uploadFetch.mockReturnValueOnce(fetchPromise)

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await addAndSubmit(user, input, file)

    // The fetch promise is still pending at this point (we haven't called
    // resolveFetch yet), so this genuinely proves the input is disabled
    // *while* the request is in flight, and a loading indicator is shown.
    expect(input).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/uploading 1 photo/i)
    expect(uploadFetch).toHaveBeenCalledTimes(1)

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

    expect(uploadFetch).toHaveBeenCalledTimes(1)
  })

  it('does not fire a second fetch if the input is interacted with again while a request is already in flight', async () => {
    const user = userEvent.setup()

    let resolveFetch
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    uploadFetch.mockReturnValueOnce(fetchPromise)

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    const file = makeFixtureImageFile()

    await addAndSubmit(user, input, file)

    // Request is still pending -- input should be disabled, blocking a
    // second selection.
    expect(input).toBeDisabled()
    expect(uploadFetch).toHaveBeenCalledTimes(1)

    // Attempt a second file selection while the first request is still in
    // flight. `user.upload` is a no-op on a disabled input (mirrors real
    // browser behavior), so this must not trigger a second fetch call.
    await addAndSubmit(user, input, makeFixtureImageFile())

    expect(uploadFetch).toHaveBeenCalledTimes(1)

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
    uploadFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    await addAndSubmit(user, input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i)
    })

    // The input is re-enabled after the failure so the user can retry.
    expect(input).not.toBeDisabled()
  })

  it('shows a visible error message when the backend returns a 4xx response', async () => {
    const user = userEvent.setup()
    uploadFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ detail: 'Uploaded file is empty.' }),
    })

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    await addAndSubmit(user, input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/uploaded file is empty/i)
    })
  })

  it('shows a session-expired message (not a generic/raw error) when the upload gets a 401', async () => {
    const user = userEvent.setup()
    uploadFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Not authenticated' }),
    })

    renderUploadPage()

    const input = screen.getByLabelText(/take or choose a photo/i)
    await addAndSubmit(user, input, makeFixtureImageFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    })
    // Not the raw backend-authored 401 detail string.
    expect(screen.queryByText(/not authenticated/i)).not.toBeInTheDocument()
  })

  it('uploads the prepared (downscaled) file rather than the raw selection', async () => {
    const user = userEvent.setup()
    const prepared = new File([new Uint8Array([9])], 'small.jpg', { type: 'image/jpeg' })
    prepareUploadImage.mockResolvedValueOnce(prepared)
    uploadFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 42 }),
    })

    renderUploadPage()
    const raw = makeFixtureImageFile()
    await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), raw)

    await waitFor(() => {
      expect(screen.getByText(/item #42/i)).toBeInTheDocument()
    })
    expect(prepareUploadImage).toHaveBeenCalledWith(raw)
    expect(uploadFetch.mock.calls[0][1].body.getAll('photos')).toEqual([prepared])
  })

  it('passes an abort signal to fetch', async () => {
    const user = userEvent.setup()
    uploadFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 1 }) })
    renderUploadPage()
    await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), makeFixtureImageFile())
    await waitFor(() => expect(screen.getByText(/item #1/i)).toBeInTheDocument())
    expect(uploadFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  describe('photo tray', () => {
    const uploadButton = (n) => screen.getByRole('button', { name: `Upload ${n} ${n === 1 ? 'photo' : 'photos'}` })

    it('does not upload on select; shows thumbnails, count and "Upload 2 photos" for 2 files', async () => {
      const user = userEvent.setup()
      renderUploadPage()
      const input = screen.getByLabelText(/take or choose a photo/i)
      expect(input).toHaveAttribute('multiple')
      expect(screen.getByRole('button', { name: /upload photos/i })).toBeDisabled()

      await user.upload(input, [makeFixtureImageFile('a.jpg'), makeFixtureImageFile('b.jpg')])

      expect(uploadFetch).not.toHaveBeenCalled()
      expect(screen.getAllByRole('img', { name: /selected photo/i })).toHaveLength(2)
      expect(screen.getByText('2 of 10')).toBeInTheDocument()
      expect(uploadButton(2)).toBeEnabled()
      expect(screen.getByLabelText(/add more photos/i)).toBe(input)
      expect(input.value).toBe('')
    })

    it('removes a photo, updating the count and revoking its thumbnail URL', async () => {
      const user = userEvent.setup()
      renderUploadPage()
      await user.upload(screen.getByLabelText(/take or choose a photo/i), [
        makeFixtureImageFile('a.jpg'),
        makeFixtureImageFile('b.jpg'),
      ])

      await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))

      expect(screen.getAllByRole('img', { name: /selected photo/i })).toHaveLength(1)
      expect(screen.getByText('1 of 10')).toBeInTheDocument()
      expect(uploadButton(1)).toBeEnabled()
      expect(revokeSpy).toHaveBeenCalledWith('blob:thumb-1')

      await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
      expect(screen.queryByRole('img', { name: /selected photo/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /upload photos/i })).toBeDisabled()
      expect(screen.getByLabelText(/take or choose a photo/i)).toBeInTheDocument()
    })

    it('accumulates across several picks and lets the same file be picked again', async () => {
      const user = userEvent.setup()
      renderUploadPage()
      const input = screen.getByLabelText(/take or choose a photo/i)
      const file = makeFixtureImageFile()
      await user.upload(input, file)
      await user.upload(input, file)
      expect(screen.getByText('2 of 10')).toBeInTheDocument()
    })

    it('caps the tray at 10 photos and shows a notice', async () => {
      const user = userEvent.setup()
      renderUploadPage()
      const input = screen.getByLabelText(/take or choose a photo/i)
      const files = Array.from({ length: 12 }, (_, i) => makeFixtureImageFile(`p${i}.jpg`))
      await user.upload(input, files)

      expect(screen.getAllByRole('img', { name: /selected photo/i })).toHaveLength(10)
      expect(screen.getByText('10 of 10')).toBeInTheDocument()
      expect(screen.getByText('Up to 10 photos per item.')).toBeInTheDocument()

      await user.upload(input, makeFixtureImageFile('extra.jpg'))
      expect(screen.getAllByRole('img', { name: /selected photo/i })).toHaveLength(10)
      expect(screen.getByText('Up to 10 photos per item.')).toBeInTheDocument()
    })

    it('submits every photo as a `photos` part plus the hint, in order, and navigates', async () => {
      const user = userEvent.setup()
      uploadFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 9 }) })
      renderUploadPage()
      await user.type(screen.getByLabelText(/hint \(optional\)/i), 'drill')
      prepareUploadImage.mockClear()
      const a = makeFixtureImageFile('a.jpg')
      const b = makeFixtureImageFile('b.jpg')
      await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), [a, b])

      await waitFor(() => expect(screen.getByText(/item #9/i)).toBeInTheDocument())
      const body = uploadFetch.mock.calls[0][1].body
      expect(body.getAll('photos')).toEqual([a, b])
      expect(body.get('hint')).toBe('drill')
      expect(prepareUploadImage).toHaveBeenCalledTimes(2)
    })

    it('disables remove, add and upload while uploading, and shows N-photo progress', async () => {
      const user = userEvent.setup()
      let resolveFetch
      uploadFetch.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)))
      renderUploadPage()
      const input = screen.getByLabelText(/take or choose a photo/i)
      await addAndSubmit(user, input, [makeFixtureImageFile('a.jpg'), makeFixtureImageFile('b.jpg')])

      expect(screen.getByRole('status')).toHaveTextContent(/uploading 2 photos/i)
      expect(input).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeDisabled()
      expect(uploadButton(2)).toBeDisabled()

      resolveFetch({ ok: true, status: 201, json: async () => ({ id: 1 }) })
      await waitFor(() => expect(screen.getByText(/item #1/i)).toBeInTheDocument())
    })

    it('revokes thumbnail URLs after a successful upload and on unmount', async () => {
      const user = userEvent.setup()
      uploadFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 1 }) })
      renderUploadPage()
      await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), makeFixtureImageFile())
      await waitFor(() => expect(screen.getByText(/item #1/i)).toBeInTheDocument())
      expect(revokeSpy).toHaveBeenCalledWith('blob:thumb-1')

      cleanup()
      revokeSpy.mockClear()
      const { unmount } = renderUploadPage()
      await user.upload(screen.getByLabelText(/take or choose a photo/i), makeFixtureImageFile())
      unmount()
      expect(revokeSpy).toHaveBeenCalledWith('blob:thumb-2')
    })
  })

  describe('upload timeout', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    // fetch mock that never resolves but rejects with AbortError on abort.
    function hangingFetch(_url, options) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    }

    it('shows a timeout error, re-enables the input, and allows a successful retry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      uploadFetch.mockImplementationOnce(hangingFetch)
      uploadFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 7 }) })

      renderUploadPage()
      const input = screen.getByLabelText(/take or choose a photo/i)
      const file = makeFixtureImageFile()
      await addAndSubmit(user, input, file)
      expect(input).toBeDisabled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS + 1)
      })

      expect(screen.getByRole('alert')).toHaveTextContent(/taking too long/i)
      expect(input).not.toBeDisabled()
      expect(input.value).toBe('')

      // Try again re-submits the same tray.
      await user.click(screen.getByRole('button', { name: /try again/i }))
      await waitFor(() => {
        expect(screen.getByText(/item #7/i)).toBeInTheDocument()
      })
      expect(uploadFetch).toHaveBeenCalledTimes(2)
    })

    it('does not show the timeout message for non-timeout failures', async () => {
      const user = userEvent.setup()
      uploadFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      renderUploadPage()
      await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), makeFixtureImageFile())
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i)
      })
      expect(screen.queryByText(/taking too long/i)).not.toBeInTheDocument()
    })

    it('clears the timer on success so no late abort/error occurs', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      uploadFetch.mockImplementationOnce(async () => {
        return { ok: true, status: 201, json: async () => ({ id: 5 }) }
      })

      renderUploadPage()
      await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), makeFixtureImageFile())
      await waitFor(() => {
        expect(screen.getByText(/item #5/i)).toBeInTheDocument()
      })

      // The timeout timer must be gone (success clears it; navigation also
      // unmounts the page, which aborts the finished request harmlessly).
      expect(vi.getTimerCount()).toBe(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS * 2)
      })
      expect(screen.getByText(/item #5/i)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('shows the preparing state with the input disabled while the photo is being prepared', async () => {
    const user = userEvent.setup()
    let resolvePrepare
    prepareUploadImage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePrepare = resolve
      }),
    )
    uploadFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 3 }) })

    renderUploadPage()
    const input = screen.getByLabelText(/take or choose a photo|preparing/i)
    const file = makeFixtureImageFile()
    await addAndSubmit(user, input, file)

    expect(screen.getByRole('status')).toHaveTextContent(/preparing photos/i)
    expect(input).toBeDisabled()
    expect(uploadFetch).not.toHaveBeenCalled()

    resolvePrepare(file)
    await waitFor(() => {
      expect(screen.getByText(/item #3/i)).toBeInTheDocument()
    })
  })

  it('aborts the request on unmount and does not update state or log errors afterwards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      let signal
      uploadFetch.mockImplementationOnce((_url, options) => {
        signal = options.signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      })

      const { unmount } = renderUploadPage()
      await addAndSubmit(user, screen.getByLabelText(/take or choose a photo/i), makeFixtureImageFile())
      expect(signal.aborted).toBe(false)

      unmount()
      expect(signal.aborted).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS + 1)
      })
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('UploadPage "Recently added" strip', () => {
  beforeEach(() => {
    installFetch()
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  function listResponse(items) {
    return { ok: true, status: 200, json: async () => items }
  }

  it('renders nothing with 0 items', async () => {
    renderUploadPage()
    await waitFor(() => expect(itemsFetch).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText('Recently added')).not.toBeInTheDocument()
  })

  it('shows exactly the 3 newest items, newest first, linking to their pages', async () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({
      id,
      identified_name: id === 4 ? null : `Thing ${id}`,
      decision: id === 5 ? 'give_away' : 'sell',
      photo_url: null,
    }))
    itemsFetch.mockResolvedValue(listResponse(items))
    renderUploadPage()

    expect(await screen.findByText('Recently added')).toBeInTheDocument()
    const tiles = screen.getAllByRole('listitem')
    expect(tiles).toHaveLength(3)
    const links = tiles.map((li) => li.querySelector('a').getAttribute('href'))
    expect(links).toEqual(['/items/5', '/items/4', '/items/3'])
    expect(tiles[0]).toHaveTextContent('Thing 5')
    expect(tiles[0]).toHaveTextContent('Give away')
    expect(tiles[1]).toHaveTextContent('Item #4')
    expect(screen.getByRole('link', { name: 'See all →' })).toHaveAttribute('href', '/inventory')
  })

  it('renders nothing and no alert when the fetch fails', async () => {
    itemsFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    renderUploadPage()
    await waitFor(() => expect(itemsFetch).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText('Recently added')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders nothing and no alert on a non-ok response', async () => {
    itemsFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'x', json: async () => ({}) })
    renderUploadPage()
    await waitFor(() => expect(itemsFetch).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText('Recently added')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useAuthedImageUrl } from './useAuthedImageUrl.js'
import { API_BASE_URL, SESSION_EXPIRED_EVENT, SESSION_TOKEN_STORAGE_KEY } from './api.js'

// A minimal consumer that surfaces the hook's return value as text, so
// these tests can assert on rendered output (and drive unmount/rerender)
// rather than using a renderHook helper this project doesn't already
// depend on.
function ProbeComponent({ photoUrl }) {
  const objectUrl = useAuthedImageUrl(photoUrl)
  return <p data-testid="object-url">{objectUrl ?? ''}</p>
}

describe('useAuthedImageUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('does not fetch anything when photoUrl is null/undefined', () => {
    render(<ProbeComponent photoUrl={null} />)

    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('object-url')).toHaveTextContent('')
  })

  it('fetches the photo via apiFetch (Authorization header attached) and returns a blob: object URL once ready', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'my-token')
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
    })

    render(<ProbeComponent photoUrl="/uploads/a.jpg" />)

    // Starts in a loading/null state.
    expect(screen.getByTestId('object-url')).toHaveTextContent('')

    await waitFor(() => {
      expect(screen.getByTestId('object-url')).toHaveTextContent(/^blob:/)
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(`${API_BASE_URL}/uploads/a.jpg`)
    expect(options.headers.Authorization).toBe('Bearer my-token')
  })

  it('stays null (placeholder-friendly) when the fetch fails with a non-401 error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })

    render(<ProbeComponent photoUrl="/uploads/missing.jpg" />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByTestId('object-url')).toHaveTextContent('')
  })

  it('on a 401, relies on apiFetch/AuthContext session-expired handling instead of building a second mechanism', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'stale-token')
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid or expired session token.' }),
    })

    const listener = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, listener)

    render(<ProbeComponent photoUrl="/uploads/a.jpg" />)

    await waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1)
    })

    // apiFetch (api.js) already cleared the stale token on the 401.
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
    // No object URL -- the caller renders a placeholder, never a broken
    // image, while the app-level sign-in gate takes over.
    expect(screen.getByTestId('object-url')).toHaveTextContent('')

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener)
  })

  it('revokes the previous object URL when photoUrl changes', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
    })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')

    const { rerender } = render(<ProbeComponent photoUrl="/uploads/a.jpg" />)

    let firstUrl
    await waitFor(() => {
      firstUrl = screen.getByTestId('object-url').textContent
      expect(firstUrl).toMatch(/^blob:/)
    })

    rerender(<ProbeComponent photoUrl="/uploads/b.jpg" />)

    await waitFor(() => {
      expect(revokeSpy).toHaveBeenCalledWith(firstUrl)
    })

    revokeSpy.mockRestore()
  })

  it('revokes the object URL on unmount', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
    })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')

    const { unmount } = render(<ProbeComponent photoUrl="/uploads/a.jpg" />)

    let objectUrl
    await waitFor(() => {
      objectUrl = screen.getByTestId('object-url').textContent
      expect(objectUrl).toMatch(/^blob:/)
    })

    act(() => {
      unmount()
    })

    expect(revokeSpy).toHaveBeenCalledWith(objectUrl)

    revokeSpy.mockRestore()
  })
})

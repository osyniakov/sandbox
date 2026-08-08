import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  API_BASE_URL,
  SESSION_EXPIRED_EVENT,
  SESSION_TOKEN_STORAGE_KEY,
  apiFetch,
} from './api.js'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('attaches the Authorization header when a token is present in localStorage', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'my-token')
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

    await apiFetch('/items')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(`${API_BASE_URL}/items`)
    expect(options.headers.Authorization).toBe('Bearer my-token')
  })

  it('omits the Authorization header when no token is present', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

    await apiFetch('/items')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, options] = fetch.mock.calls[0]
    expect(options?.headers?.Authorization).toBeUndefined()
  })

  it('preserves other headers/options the caller passed while adding Authorization', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'my-token')
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

    await apiFetch('/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    const [, options] = fetch.mock.calls[0]
    expect(options.method).toBe('PATCH')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.headers.Authorization).toBe('Bearer my-token')
    expect(options.body).toBe('{}')
  })

  it('clears the stored token and dispatches auth:session-expired on a 401 response', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'stale-token')
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid or expired session token.' }),
    })

    const listener = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, listener)

    const response = await apiFetch('/items')

    expect(response.status).toBe(401)
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener)
  })

  it('does not dispatch auth:session-expired on a non-401 response', async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'my-token')
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

    const listener = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, listener)

    await apiFetch('/items')

    expect(listener).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('my-token')

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ENTRIES,
  __resetPhotoBlobCacheForTests,
  clearPhotoBlobCache,
  evictPhotoBlob,
  getPhotoBlob,
  peekPhotoBlob,
} from './photoBlobCache.js'

const ok = () => ({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) })

describe('photoBlobCache', () => {
  beforeEach(() => {
    __resetPhotoBlobCacheForTests()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok())))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('dedupes concurrent and later calls into one fetch', async () => {
    const [a, b] = await Promise.all([getPhotoBlob('/api/uploads/a.png'), getPhotoBlob('/api/uploads/a.png')])
    expect(a).toBe(b)
    await getPhotoBlob('/api/uploads/a.png')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('peek returns undefined until resolved, then the blob', async () => {
    const p = getPhotoBlob('/api/uploads/a.png')
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
    const blob = await p
    expect(peekPhotoBlob('/api/uploads/a.png')).toBe(blob)
  })

  it('evicts on failure so a retry refetches; message names the status', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(getPhotoBlob('/api/uploads/a.png')).rejects.toThrow('Could not load the photo (500).')
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
    await expect(getPhotoBlob('/api/uploads/a.png')).resolves.toBeInstanceOf(Blob)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('evictPhotoBlob removes an entry; an in-flight fetch finishing later is not re-stored', async () => {
    await getPhotoBlob('/api/uploads/a.png')
    evictPhotoBlob('/api/uploads/a.png')
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
    const p = getPhotoBlob('/api/uploads/b.png')
    evictPhotoBlob('/api/uploads/b.png')
    await p
    expect(peekPhotoBlob('/api/uploads/b.png')).toBeUndefined()
  })

  it('caps entries with LRU order', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) await getPhotoBlob(`/api/uploads/${i}.png`)
    peekPhotoBlob('/api/uploads/0.png') // refresh 0; 1 is now oldest
    await getPhotoBlob('/api/uploads/new.png')
    expect(peekPhotoBlob('/api/uploads/1.png')).toBeUndefined()
    expect(peekPhotoBlob('/api/uploads/0.png')).toBeDefined()
    expect(peekPhotoBlob('/api/uploads/new.png')).toBeDefined()
  })

  it('clearPhotoBlobCache empties the cache; an in-flight fetch finishing later is not re-cached', async () => {
    await getPhotoBlob('/api/uploads/a.png')
    const p = getPhotoBlob('/api/uploads/b.png')
    clearPhotoBlobCache()
    expect(peekPhotoBlob('/api/uploads/a.png')).toBeUndefined()
    await p
    expect(peekPhotoBlob('/api/uploads/b.png')).toBeUndefined()
    await getPhotoBlob('/api/uploads/b.png')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('resolves a typed blob and falls back to the Content-Type header', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['x']), headers: new Headers({ 'Content-Type': 'image/webp' }) })
    expect((await getPhotoBlob('/api/uploads/c.webp')).type).toBe('image/webp')
  })
})

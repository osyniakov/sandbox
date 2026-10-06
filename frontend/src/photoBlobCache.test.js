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
    const [a, b] = await Promise.all([getPhotoBlob('/uploads/a.png'), getPhotoBlob('/uploads/a.png')])
    expect(a).toBe(b)
    await getPhotoBlob('/uploads/a.png')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('peek returns undefined until resolved, then the blob', async () => {
    const p = getPhotoBlob('/uploads/a.png')
    expect(peekPhotoBlob('/uploads/a.png')).toBeUndefined()
    const blob = await p
    expect(peekPhotoBlob('/uploads/a.png')).toBe(blob)
  })

  it('evicts on failure so a retry refetches; message names the status', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(getPhotoBlob('/uploads/a.png')).rejects.toThrow('Could not load the photo (500).')
    expect(peekPhotoBlob('/uploads/a.png')).toBeUndefined()
    await expect(getPhotoBlob('/uploads/a.png')).resolves.toBeInstanceOf(Blob)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('evictPhotoBlob removes an entry; an in-flight fetch finishing later is not re-stored', async () => {
    await getPhotoBlob('/uploads/a.png')
    evictPhotoBlob('/uploads/a.png')
    expect(peekPhotoBlob('/uploads/a.png')).toBeUndefined()
    const p = getPhotoBlob('/uploads/b.png')
    evictPhotoBlob('/uploads/b.png')
    await p
    expect(peekPhotoBlob('/uploads/b.png')).toBeUndefined()
  })

  it('caps entries with LRU order', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) await getPhotoBlob(`/uploads/${i}.png`)
    peekPhotoBlob('/uploads/0.png') // refresh 0; 1 is now oldest
    await getPhotoBlob('/uploads/new.png')
    expect(peekPhotoBlob('/uploads/1.png')).toBeUndefined()
    expect(peekPhotoBlob('/uploads/0.png')).toBeDefined()
    expect(peekPhotoBlob('/uploads/new.png')).toBeDefined()
  })

  it('clearPhotoBlobCache empties the cache; an in-flight fetch finishing later is not re-cached', async () => {
    await getPhotoBlob('/uploads/a.png')
    const p = getPhotoBlob('/uploads/b.png')
    clearPhotoBlobCache()
    expect(peekPhotoBlob('/uploads/a.png')).toBeUndefined()
    await p
    expect(peekPhotoBlob('/uploads/b.png')).toBeUndefined()
    await getPhotoBlob('/uploads/b.png')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('resolves a typed blob and falls back to the Content-Type header', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['x']), headers: new Headers({ 'Content-Type': 'image/webp' }) })
    expect((await getPhotoBlob('/uploads/c.webp')).type).toBe('image/webp')
  })
})

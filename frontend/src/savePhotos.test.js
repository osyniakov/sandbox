import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFiles, extensionFor, savePhotos, slugify } from './savePhotos.js'

const file = (name) => new File(['x'], name, { type: 'image/jpeg' })

describe('slugify / extensionFor', () => {
  it('slugifies umlauts, symbols and length', () => {
    expect(slugify('Bohrmaschine Größe Ä Ö Ü!')).toBe('bohrmaschine-groesse-ae-oe-ue')
    expect(slugify('Café  -- Ünder')).toBe('cafe-ue' + 'nder')
    expect(slugify('')).toBe('')
    expect(slugify('a'.repeat(100)).length).toBe(60)
  })
  it('maps content types, then URL extension, then jpg', () => {
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/webp; x=1')).toBe('webp')
    expect(extensionFor('image/heic')).toBe('heic')
    expect(extensionFor('', '/uploads/a.gif')).toBe('gif')
    expect(extensionFor('application/octet-stream', '/uploads/noext')).toBe('jpg')
  })
})

describe('savePhotos', () => {
  let clicked
  beforeEach(() => {
    clicked = []
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked.push(this.download)
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete navigator.share
    delete navigator.canShare
  })

  it('uses share when canShare is true', async () => {
    navigator.canShare = vi.fn(() => true)
    navigator.share = vi.fn().mockResolvedValue()
    const files = [file('a.jpg')]
    await savePhotos(files)
    expect(navigator.share).toHaveBeenCalledWith({ files })
    expect(clicked).toEqual([])
  })
  it('ignores AbortError', async () => {
    navigator.canShare = () => true
    navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('c'), { name: 'AbortError' }))
    await savePhotos([file('a.jpg')])
    expect(clicked).toEqual([])
  })
  it('falls back to download on other share errors', async () => {
    navigator.canShare = () => true
    navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('n'), { name: 'NotAllowedError' }))
    await savePhotos([file('a.jpg')])
    expect(clicked).toEqual(['a.jpg'])
  })
  it('downloads one anchor per file with the right names when share is unavailable', async () => {
    await savePhotos([file('x-1.jpg'), file('x-2.png')])
    expect(clicked).toEqual(['x-1.jpg', 'x-2.png'])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })
  it('downloadFiles revokes object urls afterwards', async () => {
    vi.useFakeTimers()
    const p = downloadFiles([file('a.jpg')])
    await p
    vi.advanceTimersByTime(41000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
    vi.useRealTimers()
  })

  it('falls back to download when canShare throws', async () => {
    navigator.canShare = () => { throw new Error('boom') }
    await savePhotos([file('a.jpg')])
    expect(clicked).toEqual(['a.jpg'])
  })
  it('returns retry (no download) on NotAllowedError when requested', async () => {
    navigator.canShare = () => true
    navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('n'), { name: 'NotAllowedError' }))
    expect(await savePhotos([file('a.jpg')], { retryOnNotAllowed: true })).toBe('retry')
    expect(clicked).toEqual([])
  })
})

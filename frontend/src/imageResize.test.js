import { describe, expect, it, vi } from 'vitest'
import { prepareUploadImage } from './imageResize.js'

function makeFile(size, name = 'IMG_0001.HEIC', type = 'image/heic') {
  return new File([new Uint8Array(size)], name, { type })
}

// Fake canvas recording its dimensions; toBlob yields a blob of `outSize`.
function makeDeps({ width, height, outSize = 1000, blobNull = false }) {
  const bitmap = { width, height, close: vi.fn() }
  const drawImage = vi.fn()
  const canvases = []
  const createCanvas = vi.fn((w, h) => {
    const canvas = {
      width: w,
      height: h,
      getContext: () => ({ drawImage }),
      toBlob: (cb, type, quality) => {
        canvas.encoded = { type, quality }
        cb(blobNull ? null : new Blob([new Uint8Array(outSize)], { type }))
      },
    }
    canvases.push(canvas)
    return canvas
  })
  const decode = vi.fn(async () => bitmap)
  return { bitmap, drawImage, canvases, createCanvas, decode }
}

const BIG = 2 * 1024 * 1024

describe('prepareUploadImage', () => {
  it('returns small files unchanged without decoding', async () => {
    const d = makeDeps({ width: 4000, height: 3000 })
    const file = makeFile(100 * 1024)
    const out = await prepareUploadImage(file, {
      createImageBitmap: d.decode,
      createCanvas: d.createCanvas,
    })
    expect(out).toBe(file)
    expect(d.decode).not.toHaveBeenCalled()
  })

  it('downscales a landscape photo to a 1600px longest edge', async () => {
    const d = makeDeps({ width: 4032, height: 3024 })
    const file = makeFile(BIG)
    const out = await prepareUploadImage(file, {
      createImageBitmap: d.decode,
      createCanvas: d.createCanvas,
    })
    expect(d.decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(d.canvases[0].width).toBe(1600)
    expect(d.canvases[0].height).toBe(1200)
    expect(d.canvases[0].encoded).toEqual({ type: 'image/jpeg', quality: 0.85 })
    expect(out).toBeInstanceOf(File)
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0001.jpg')
    expect(out.size).toBe(1000)
    expect(d.bitmap.close).toHaveBeenCalled()
  })

  it('downscales a portrait photo to a 1600px longest edge', async () => {
    const d = makeDeps({ width: 3024, height: 4032 })
    await prepareUploadImage(makeFile(BIG), {
      createImageBitmap: d.decode,
      createCanvas: d.createCanvas,
    })
    expect(d.canvases[0].width).toBe(1200)
    expect(d.canvases[0].height).toBe(1600)
  })

  it('does not upscale images already within maxEdge', async () => {
    const d = makeDeps({ width: 1000, height: 800 })
    await prepareUploadImage(makeFile(BIG), {
      createImageBitmap: d.decode,
      createCanvas: d.createCanvas,
    })
    expect(d.canvases[0].width).toBe(1000)
    expect(d.canvases[0].height).toBe(800)
  })

  it('returns the original when the re-encoded blob is not smaller', async () => {
    const d = makeDeps({ width: 4000, height: 3000, outSize: BIG + 1 })
    const file = makeFile(BIG)
    const out = await prepareUploadImage(file, {
      createImageBitmap: d.decode,
      createCanvas: d.createCanvas,
    })
    expect(out).toBe(file)
  })

  it('returns the original when decoding throws', async () => {
    const file = makeFile(BIG)
    const out = await prepareUploadImage(file, {
      createImageBitmap: vi.fn().mockRejectedValue(new Error('cannot decode')),
    })
    expect(out).toBe(file)
  })

  it('returns the original when createImageBitmap is unavailable', async () => {
    const file = makeFile(BIG)
    // jsdom has no createImageBitmap, so the default path is exercised.
    expect(await prepareUploadImage(file)).toBe(file)
  })

  it('returns the original when toBlob yields null (and closes the bitmap)', async () => {
    const d = makeDeps({ width: 4000, height: 3000, blobNull: true })
    const file = makeFile(BIG)
    const out = await prepareUploadImage(file, {
      createImageBitmap: d.decode,
      createCanvas: d.createCanvas,
    })
    expect(out).toBe(file)
    expect(d.bitmap.close).toHaveBeenCalled()
  })

  it('returns the original when canvas creation throws', async () => {
    const d = makeDeps({ width: 4000, height: 3000 })
    const file = makeFile(BIG)
    const out = await prepareUploadImage(file, {
      createImageBitmap: d.decode,
      createCanvas: () => {
        throw new Error('no canvas')
      },
    })
    expect(out).toBe(file)
    expect(d.bitmap.close).toHaveBeenCalled()
  })

  it('returns the original when getContext returns null', async () => {
    const d = makeDeps({ width: 4000, height: 3000 })
    const file = makeFile(BIG)
    const out = await prepareUploadImage(file, {
      createImageBitmap: d.decode,
      createCanvas: () => ({ getContext: () => null }),
    })
    expect(out).toBe(file)
    expect(d.bitmap.close).toHaveBeenCalled()
  })
})

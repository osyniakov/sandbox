// Client-side photo downscaling for uploads. Full-resolution phone photos are
// several MB and upload very slowly over mobile uplinks; the vision model
// doesn't need that resolution.

export const DEFAULT_MAX_EDGE = 1600
export const DEFAULT_QUALITY = 0.85
export const DEFAULT_SKIP_BYTES = 500 * 1024

function defaultCreateCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

// Works with both OffscreenCanvas (convertToBlob) and HTMLCanvasElement
// (toBlob). Resolves null if encoding fails.
function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

function jpgName(name) {
  const base = name.replace(/\.[^./\\]+$/, '')
  return `${base || 'photo'}.jpg`
}

// Returns a (possibly downscaled) JPEG File, or the original file untouched.
// Never throws: on any failure the original file is returned.
//
// options: maxEdge, quality, skipBytes, createImageBitmap(file, opts),
// createCanvas(width, height) -- the last two are injectable for tests.
export async function prepareUploadImage(file, options = {}) {
  const {
    maxEdge = DEFAULT_MAX_EDGE,
    quality = DEFAULT_QUALITY,
    skipBytes = DEFAULT_SKIP_BYTES,
    createImageBitmap: decode = typeof createImageBitmap === 'function'
      ? createImageBitmap
      : undefined,
    createCanvas = defaultCreateCanvas,
  } = options

  if (file.size <= skipBytes) {
    return file
  }

  let bitmap
  try {
    if (typeof decode !== 'function') {
      return file
    }
    bitmap = await decode(file, { imageOrientation: 'from-image' })

    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > maxEdge ? maxEdge / longest : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (!blob || blob.size >= file.size) {
      return file
    }

    return new File([blob], jpgName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    try {
      bitmap?.close?.()
    } catch {
      // ignore
    }
  }
}

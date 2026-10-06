const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

export function slugify(text, max = 60) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug
}

export function extensionFor(contentType, url = '') {
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type]
  const match = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url || '')
  if (match) return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
  return 'jpg'
}

// Base name (no number/extension): slugified item name or "item-<id>".
export function baseNameFor(item) {
  return slugify(item?.identified_name) || `item-${item?.id}`
}

export function photoFilename(base, n) {
  return (type, url) => `${base}-${n}.${extensionFor(type, url)}`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function downloadFiles(files, delayMs = 150) {
  for (let i = 0; i < files.length; i++) {
    const objectUrl = URL.createObjectURL(files[i])
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = files[i].name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 40000)
    if (i < files.length - 1) await sleep(delayMs)
  }
}

// Share sheet when files can be shared, otherwise download. A cancelled
// share (AbortError) is a no-op. Other share failures fall back to download,
// except NotAllowedError when `retryOnNotAllowed` is set: then nothing is
// downloaded and 'retry' is returned (the gesture expired; tap again).
// Returns 'shared' | 'cancelled' | 'downloaded' | 'retry'. Share is called
// synchronously (no await before it) so the tap's activation is still valid.
export async function savePhotos(files, { retryOnNotAllowed = false } = {}) {
  try {
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files })) {
      await navigator.share({ files })
      return 'shared'
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'
    if (retryOnNotAllowed && err?.name === 'NotAllowedError') return 'retry'
  }
  await downloadFiles(files)
  return 'downloaded'
}

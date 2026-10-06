import { useEffect, useRef, useState } from 'react'
import ItemPhoto from './ItemPhoto.jsx'
import { AlertCircle, Camera, ChevronLeft, ChevronRight, Download } from './icons.jsx'
import { baseNameFor, extensionFor, fetchPhotoFile, savePhotos } from './savePhotos.js'
import { addItemPhotos, removeItemPhoto } from './itemsApi.js'
import { prepareUploadImage } from './imageResize.js'

export const MAX_PHOTOS = 10
const TILE_GAP_PX = 12

// Photos for the carousel; falls back to the cover `photo_url` for older
// responses without `photos`. Legacy entries may have `id: null`.
function photosOf(item) {
  if (Array.isArray(item.photos) && item.photos.length > 0) return item.photos
  return item.photo_url ? [{ id: null, url: item.photo_url, position: 0 }] : []
}

// Flex row under each tile. Extend with more buttons (e.g. Save) as children.
export function TileControls({ children }) {
  return <div className="mt-1.5 flex min-h-8 items-center gap-2">{children}</div>
}

function PhotoCarousel({ item, onItemChange }) {
  const photos = photosOf(item)
  const total = photos.length
  const name = item.identified_name || `item #${item.id}`
  const scrollerRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const [current, setCurrent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const savingRef = useRef(false)
  // url -> { promise, file }: prefetched Files, only when Web Share exists.
  const cacheRef = useRef(new Map())

  const pendingRef = useRef(null)
  const pendingTimerRef = useRef(null)

  useEffect(() => {
    const el = scrollerRef.current
    const settle = () => {
      clearTimeout(pendingTimerRef.current)
      pendingRef.current = null
    }
    el?.addEventListener('scrollend', settle)
    return () => {
      el?.removeEventListener('scrollend', settle)
      clearTimeout(pendingTimerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  const shown = Math.min(current, Math.max(total - 1, 0))

  function tileStep() {
    const tile = scrollerRef.current?.querySelector('[data-photo-tile]')
    return (tile?.offsetWidth || 0) + TILE_GAP_PX
  }

  function onScroll() {
    const el = scrollerRef.current
    if (!el) return
    if (pendingRef.current !== null) {
      // Button-initiated scroll in flight: keep the index go() chose.
      armPending(pendingRef.current)
      return
    }
    // Fully scrolled: the trailing add tile (and wide screens) mean the last
    // photo can never reach the left edge, so clamp to the last photo.
    if (el.scrollWidth > el.clientWidth && el.scrollWidth - el.clientWidth - el.scrollLeft <= 1) {
      setCurrent(total - 1)
      return
    }
    const step = tileStep()
    if (step <= TILE_GAP_PX) return
    setCurrent(Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / step))))
  }

  function clearPending() {
    clearTimeout(pendingTimerRef.current)
    pendingRef.current = null
  }

  // Holds the index set by go() until the scroll it started settles.
  function armPending(next) {
    pendingRef.current = next
    clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = setTimeout(clearPending, 400)
  }

  function go(delta) {
    const next = Math.max(0, Math.min(total - 1, shown + delta))
    setCurrent(next)
    const el = scrollerRef.current
    if (!el) return
    const tiles = el.querySelectorAll('[data-photo-tile]')
    if (typeof el.scrollTo === 'function' && tiles[next] && tiles[0]) {
      armPending(next)
      el.scrollTo({ left: tiles[next].offsetLeft - tiles[0].offsetLeft, behavior: 'smooth' })
    }
  }

  async function run(action) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    try {
      const updated = await action(controller.signal)
      if (controller.signal.aborted) return
      onItemChange(updated)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Something went wrong.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function onFilesChosen(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    if (total + files.length > MAX_PHOTOS) {
      setError(`At most ${MAX_PHOTOS} photos per item.`)
      return
    }
    await run(async (signal) => {
      const prepared = []
      for (const file of files) {
        // prepareUploadImage never throws; it falls back to the original file.
        prepared.push(await prepareUploadImage(file))
      }
      return addItemPhotos(item.id, prepared, signal)
    })
  }

  // Keep the cache bounded to the current photos; prefetch only when
  // navigator.canShare exists (iOS needs share called without an await).
  const urlsKey = photos.map((ph) => ph.url).join('\n')
  useEffect(() => {
    const cache = cacheRef.current
    const urls = urlsKey ? urlsKey.split('\n') : []
    for (const key of [...cache.keys()]) if (!urls.includes(key)) cache.delete(key)
    if (typeof navigator === 'undefined' || !navigator.canShare) return
    for (const url of urls) {
      if (cache.has(url)) continue
      const entry = { file: null, promise: null }
      entry.promise = fetchPhotoFile(url, 'photo').then(
        (file) => {
          entry.file = file
          return file
        },
        (err) => {
          if (cache.get(url) === entry) cache.delete(url) // silent; click retries
          throw err
        },
      )
      entry.promise.catch(() => {})
      cache.set(url, entry)
    }
  }, [urlsKey])

  function named(file, url, index, base) {
    const name = `${base}-${index + 1}.${extensionFor(file.type, url)}`
    return new File([file], name, { type: file.type })
  }

  // If every file is prefetched, share is called synchronously in the click.
  async function save(indices) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const base = baseNameFor(item)
      const cache = cacheRef.current
      const entries = indices.map((i) => cache.get(photos[i].url))
      const ready = entries.every((e) => e?.file)
      let files
      let awaited = false
      if (ready) {
        files = indices.map((i, k) => named(entries[k].file, photos[i].url, i, base))
      } else {
        awaited = true
        files = []
        for (const i of indices) {
          const url = photos[i].url
          const cached = cache.get(url)
          let file = cached?.file
          if (!file) {
            file = await (cached?.promise ?? fetchPhotoFile(url, 'photo')).catch(() =>
              fetchPhotoFile(url, 'photo'),
            )
            // Write back so the next tap can share synchronously.
            if (photos.some((ph) => ph.url === url) && cacheRef.current === cache) {
              cache.set(url, { file, promise: Promise.resolve(file) })
            }
          }
          files.push(named(file, url, i, base))
        }
      }
      const result = await savePhotos(files, { retryOnNotAllowed: awaited && !!navigator.canShare })
      if (result === 'retry') setStatus('Photos ready \u2014 tap Save again')
    } catch (err) {
      setError(err.message || 'Could not save the photo.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function confirmRemove(photoId) {
    setConfirmId(null)
    await run((signal) => removeItemPhoto(item.id, photoId, signal))
  }

  return (
    <section aria-label="Photos" className="min-w-0 max-w-full">
      <div className="relative min-w-0">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="flex min-w-0 max-w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
          data-testid="photo-carousel"
        >
          {total === 0 && (
            <div className="w-40 shrink-0 sm:w-56">
              <ItemPhoto item={{ ...item, photo_url: null }} className="aspect-square w-full" />
            </div>
          )}
          {photos.map((photo, index) => (
            <div
              key={photo.id ?? `legacy-${index}`}
              data-photo-tile
              tabIndex={0}
              className="w-40 shrink-0 snap-start rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:w-56"
            >
              <ItemPhoto
                item={{ ...item, photo_url: photo.url }}
                alt={`Photo ${index + 1} of ${total} of ${name}`}
                className="aspect-square w-full"
              />
              <TileControls>
                {total > 1 && photo.id != null && (
                  confirmId === photo.id ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="group" aria-label="Confirm remove">
                      <span className="basis-full text-muted">Remove this photo?</span>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        disabled={busy}
                        className="whitespace-nowrap rounded-lg border border-line px-2 py-1 font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmRemove(photo.id)}
                        disabled={busy}
                        className="whitespace-nowrap rounded-lg bg-toss-soft px-2 py-1 font-semibold text-toss"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => setConfirmId(photo.id)}
                      disabled={busy}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-toss hover:bg-toss-soft"
                    >
                      Remove
                    </button>
                  )
                )}
                <button
                  type="button"
                  aria-label={`Save photo ${index + 1}`}
                  onClick={() => save([index])}
                  disabled={saving}
                  className="ml-auto inline-flex rounded-lg border border-line p-1.5 text-muted hover:text-primary disabled:opacity-60"
                >
                  <Download size={16} />
                </button>
              </TileControls>
            </div>
          ))}
          {total < MAX_PHOTOS && (
            <div className="w-40 shrink-0 snap-start sm:w-56">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-sunken text-sm font-semibold text-muted hover:text-primary disabled:opacity-60"
              >
                <Camera size={22} />
                <span>{busy ? 'Working...' : 'Add photo'}</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                data-testid="add-photo-input"
                onChange={onFilesChosen}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {total > 1 && (
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(-1)}
            disabled={shown === 0}
            className="hidden rounded-lg border border-line p-1 disabled:opacity-40 sm:inline-flex"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {total > 0 && (
          <span aria-live="polite" data-testid="photo-indicator">
            {shown + 1} / {total}
          </span>
        )}
        {total > 1 && (
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(1)}
            disabled={shown >= total - 1}
            className="hidden rounded-lg border border-line p-1 disabled:opacity-40 sm:inline-flex"
          >
            <ChevronRight size={16} />
          </button>
        )}
        {total >= 2 && (
          <button
            type="button"
            onClick={() => save(photos.map((_, i) => i))}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-semibold hover:text-primary disabled:opacity-60"
          >
            <Download size={14} />
            <span>{saving ? 'Saving...' : 'Save all photos'}</span>
          </button>
        )}
      </div>

      {status && (
        <p role="status" className="mt-2 text-sm text-muted">
          {status}
        </p>
      )}

      {error && (
        <div
          className="mt-2 flex gap-2.5 rounded-xl bg-toss-soft px-3.5 py-3 text-sm text-toss"
          role="alert"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </section>
  )
}

export default PhotoCarousel

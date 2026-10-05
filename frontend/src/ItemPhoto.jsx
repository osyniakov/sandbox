import { useAuthedImageUrl } from './useAuthedImageUrl.js'
import { AlertCircle } from './icons.jsx'

// Renders an item's photo (or a "no photo"/loading placeholder). A component
// of its own because `useAuthedImageUrl` is a hook and can't be called inside
// a `.map()` (one call per rendered item, sandbox-dfr.5). Handles the same
// "no photo yet" / "still loading" / "ready" states ItemResultPage.jsx handles
// for its single photo -- see useAuthedImageUrl.js for the authenticated
// blob-URL rationale. `className` controls the size (default: 80px tile).
function ItemPhoto({ item, className = 'h-20 w-20 shrink-0' }) {
  const { url: photoObjectUrl, status } = useAuthedImageUrl(item.photo_url)
  const alt = item.identified_name
    ? `Photo of ${item.identified_name}`
    : `Photo of item #${item.id}`

  const tile = `${className} flex items-center justify-center rounded-xl border border-dashed border-line bg-sunken text-center text-xs text-muted`

  if (!item.photo_url) {
    return <div className={tile}>No photo</div>
  }

  if (status === 'error') {
    return (
      <div className={`${tile} flex-col gap-1`} data-testid="photo-error">
        <AlertCircle size={16} />
        <span>Photo unavailable</span>
      </div>
    )
  }

  if (!photoObjectUrl) {
    return (
      <div className={tile} data-testid="photo-placeholder">
        Loading...
      </div>
    )
  }

  return <img className={`${className} rounded-xl object-cover`} src={photoObjectUrl} alt={alt} />
}

export default ItemPhoto

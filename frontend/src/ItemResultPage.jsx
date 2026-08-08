import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE_URL } from './api.js'

// `Item.status` values that mean "the pipeline is done with this item"
// (see backend/app/pipeline.py's "Polling contract for GET /items/{id}"
// docstring, which this list mirrors exactly). `decided` is the pipeline's
// own terminal status; `listed`/`given_away`/`disposed` are later,
// post-decision statuses set by a future feature (sandbox-yqf.11), not by
// this pipeline, but they're just as terminal from this page's polling
// point of view -- `decision`/`suggested_price`/`comparable_listings` are
// all already populated by the time an item reaches any of them.
const TERMINAL_STATUSES = ['decided', 'listed', 'given_away', 'disposed']

// How often to re-fetch the item while its pipeline is still running.
// The pipeline itself can take anywhere from a few seconds to tens of
// seconds (LLM call + rate-limited scraping, see pipeline.py's module
// docstring), so a few-second poll interval is frequent enough to feel
// responsive without hammering the backend.
const POLL_INTERVAL_MS = 2500

// Upper bound on how long to keep polling a non-terminal item before
// giving up and telling the user it looks stuck, rather than polling
// silently forever. There is currently no "permanently failed" status
// (see pipeline.py's module docstring) -- a stage that exhausts its own
// retries just leaves the item parked at a `pending_*` status forever --
// so *some* client-side give-up bound is needed, or a genuinely-stuck
// item would poll this page indefinitely. Two minutes is a generous
// multiple of the pipeline's expected worst-case latency (tens of
// seconds), so it should never fire for a healthy item, only a stuck one.
const MAX_POLL_MS = 2 * 60 * 1000

// Each decision maps to a Tailwind utility triple built from the
// sell-/give-away-/throw-away-/pending- design tokens defined in
// index.css's `@theme` block (sandbox-zlt.2), so the badge's
// background/text/border colors stay in sync with that shared palette
// instead of hardcoding hex values here.
const DECISION_INFO = {
  sell: {
    label: 'Sell',
    icon: '\u{1F4B0}',
    className: 'bg-sell-bg text-sell-text border-sell-border',
  },
  give_away: {
    label: 'Give Away',
    icon: '\u{1F381}',
    className: 'bg-give-away-bg text-give-away-text border-give-away-border',
  },
  throw_away: {
    label: 'Throw Away',
    icon: '\u{1F5D1}\u{FE0F}',
    className: 'bg-throw-away-bg text-throw-away-text border-throw-away-border',
  },
  // `pending` is only ever the DB column default (see app/models.py) and
  // should never actually be reached once `status` is terminal, but this
  // keeps rendering safe (no crash, no "undefined") rather than assuming
  // the backend invariant always holds.
  pending: {
    label: 'Pending',
    icon: '…',
    className: 'bg-pending-bg text-pending-text border-pending-border',
  },
}

async function fetchItem(id, signal) {
  const response = await fetch(`${API_BASE_URL}/items/${id}`, { signal })
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`No item with id ${id}.`)
    }
    throw new Error(`Failed to load item (${response.status} ${response.statusText})`)
  }
  return response.json()
}

// The results page for a single item, rendered at `/items/:id`. Fetches
// the item on mount and polls `GET /items/{id}` every `POLL_INTERVAL_MS`
// while its `status` is non-terminal (see TERMINAL_STATUSES above),
// since the identify -> search -> decide pipeline runs as a background
// task and populates fields progressively (see backend/app/pipeline.py).
function ItemResultPage() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [stuck, setStuck] = useState(false)
  const [photoUnavailable, setPhotoUnavailable] = useState(false)
  const pollStartRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let intervalId

    pollStartRef.current = Date.now()
    setItem(null)
    setLoadError('')
    setStuck(false)
    setPhotoUnavailable(false)

    async function poll() {
      try {
        const data = await fetchItem(id, controller.signal)
        if (cancelled) return
        setItem(data)

        if (TERMINAL_STATUSES.includes(data.status)) {
          clearInterval(intervalId)
          return
        }

        if (Date.now() - pollStartRef.current >= MAX_POLL_MS) {
          setStuck(true)
          clearInterval(intervalId)
        }
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        setLoadError(err.message || 'Could not load this item.')
        clearInterval(intervalId)
      }
    }

    poll()
    intervalId = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(intervalId)
    }
  }, [id])

  if (loadError) {
    return (
      <div className="max-w-md mx-auto my-16 px-4 text-center">
        <div
          className="mt-4 rounded border border-throw-away-border bg-throw-away-bg px-4 py-3 text-throw-away-text"
          role="alert"
        >
          <p>{loadError}</p>
        </div>
        <p className="mt-4">
          <Link to="/" className="link">
            Upload another photo
          </Link>
        </p>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="max-w-md mx-auto my-16 px-4 text-center">
        <p className="italic text-text" role="status">
          Loading item #{id}...
        </p>
      </div>
    )
  }

  const isTerminal = TERMINAL_STATUSES.includes(item.status)
  const decisionInfo = DECISION_INFO[item.decision] || DECISION_INFO.pending

  return (
    <div className="max-w-md mx-auto my-16 px-4 text-center">
      <h1 className="mb-4">Item #{item.id}</h1>

      {/* Photo display: `Item.photo_url` (added in sandbox-yqf.19) is a
          relative path (e.g. "/uploads/<uuid>.jpg") served by the
          backend's StaticFiles mount -- resolved against API_BASE_URL
          the same way `fetchItem` above resolves `/items/{id}`, so this
          keeps working across dev/LAN/deployed hosts without this page
          needing to know the backend's origin separately. If the image
          fails to load (file missing on disk, network hiccup, etc.),
          `onError` swaps in a "photo unavailable" message instead of
          leaving a broken-image icon on the page. */}
      {photoUnavailable || !item.photo_url ? (
        <div
          className="my-4 rounded border border-dashed border-border px-4 py-8 italic text-text"
          data-testid="photo-placeholder"
        >
          <p>Photo unavailable.</p>
        </div>
      ) : (
        <img
          className="my-4 block max-h-80 max-w-full rounded object-contain mx-auto"
          src={`${API_BASE_URL}${item.photo_url}`}
          alt={item.identified_name ? `Photo of ${item.identified_name}` : `Photo of item #${item.id}`}
          onError={() => setPhotoUnavailable(true)}
        />
      )}

      {(item.identified_name || item.category) && (
        <div className="mb-2">
          {item.identified_name && <h2 className="mb-1">{item.identified_name}</h2>}
          {item.category && <p className="mt-0 text-sm text-text">{item.category}</p>}
        </div>
      )}

      {item.hint && <p className="mt-0 text-sm text-text">Your hint: {item.hint}</p>}

      {!isTerminal && (
        <div
          className="mt-6 rounded border border-sell-border bg-sell-bg px-4 py-3 text-sell-text"
          role="status"
        >
          <p>Still working on this item (status: {item.status})...</p>
          {stuck && (
            <p className="mt-2">
              This is taking longer than expected. The pipeline may have
              gotten stuck -- feel free to check back later.
            </p>
          )}
        </div>
      )}

      {isTerminal && (
        <>
          <div
            className={`inline-block my-4 rounded-full border px-4 py-2 font-semibold ${decisionInfo.className}`}
            role="status"
          >
            <span aria-hidden="true">{decisionInfo.icon}</span> {decisionInfo.label}
          </div>

          {item.decision === 'sell' && item.suggested_price != null && (
            <p className="font-semibold">
              Suggested price: {item.suggested_price.toFixed(2)} EUR
            </p>
          )}

          <div className="mt-6 text-left">
            <h3 className="mb-2">Comparable listings</h3>
            {item.comparable_listings.length === 0 ? (
              <p>No comparable listings found.</p>
            ) : (
              <ul className="list-disc pl-5">
                {item.comparable_listings.map((listing) => (
                  <li key={listing.id} className="mb-2">
                    <a href={listing.url} target="_blank" rel="noopener noreferrer" className="link">
                      {listing.title}
                    </a>{' '}
                    &mdash; {listing.price.toFixed(2)} EUR
                    {listing.condition && `, ${listing.condition}`}
                    {listing.location && `, ${listing.location}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <p className="mt-6">
        <Link to="/" className="link">
          Upload another photo
        </Link>
        {' | '}
        <Link to="/inventory" className="link">
          View basement inventory
        </Link>
      </p>
    </div>
  )
}

export default ItemResultPage

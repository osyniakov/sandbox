import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from './api.js'
import { useAuthedImageUrl } from './useAuthedImageUrl.js'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Gift,
  Tag,
  Trash,
} from './icons.jsx'
import { DECISION_PRIMARY_STATUS, STATUS_ACTION_LABELS, patchItemStatus } from './itemsApi.js'
import PricePosition from './PricePosition.jsx'
import { formatPrice } from './format.js'

// `Item.status` values that mean "the pipeline is done with this item"
// (see backend/app/pipeline.py's "Polling contract for GET /items/{id}"
// docstring, which this list mirrors exactly). `decided` is the pipeline's
// own terminal status; `listed`/`given_away`/`disposed` are later,
// post-decision statuses set by a future feature (sandbox-yqf.11), not by
// this pipeline, but they're just as terminal from this page's polling
// point of view -- `decision`/`suggested_price`/`comparable_listings` are
// all already populated by the time an item reaches any of them.
// `identification_failed`/`search_failed` (sandbox-khm.1) are also
// terminal -- a stage that permanently failed rather than resolving a
// decision -- so polling stops immediately for them too instead of running
// out the MAX_POLL_MS "stuck" fallback below.
const TERMINAL_STATUSES = [
  'decided',
  'listed',
  'given_away',
  'disposed',
  'identification_failed',
  'search_failed',
]

// The subset of TERMINAL_STATUSES above that mean the pipeline permanently
// failed rather than reaching a real decision -- `item.decision` stays at
// the DB default (Decision.PENDING) for these, so they need their own
// error rendering instead of falling into the decision-badge/
// comparable-listings block below.
const FAILED_STATUSES = ['identification_failed', 'search_failed']

// Status-specific copy for the FAILED_STATUSES error block, keyed by
// `item.status`.
const FAILURE_MESSAGES = {
  identification_failed:
    "We couldn't identify this item from the photo. Try a clearer or different photo.",
  search_failed:
    "We identified the item but couldn't find comparable listings right now. Try again later.",
}

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

// Each decision maps to the soft pill colours from index.css's semantic
// tokens (sell/give/toss) plus an inline-SVG icon component. `pending` has
// no icon and is only ever the DB column default (see app/models.py); it
// should never be reached once `status` is terminal, but this keeps
// rendering safe (no crash, no "undefined") rather than assuming the
// backend invariant always holds.
const DECISION_INFO = {
  sell: { label: 'Sell', Icon: Tag, className: 'bg-sell-soft text-sell' },
  give_away: { label: 'Give Away', Icon: Gift, className: 'bg-give-soft text-give' },
  throw_away: { label: 'Throw Away', Icon: Trash, className: 'bg-toss-soft text-toss' },
  pending: { label: 'Pending', Icon: null, className: 'bg-sunken text-muted' },
}

// Processing stepper: the three pipeline stages in order, and which one is
// currently active for each non-terminal status. Unknown non-terminal
// statuses fall back to step 0 (first step active).
const PROCESSING_STEPS = [
  'Identify item',
  'Search Kleinanzeigen for comparables',
  'Decide and price',
]
const ACTIVE_STEP_BY_STATUS = {
  pending_identification: 0,
  pending_search: 1,
  pending_decision: 2,
}

function activeStepIndex(status) {
  return ACTIVE_STEP_BY_STATUS[status] ?? 0
}

function ProcessingCard({ item, stuck }) {
  const active = activeStepIndex(item.status)
  return (
    <div
      className="mt-8 rounded-2xl border border-line bg-surface p-5 shadow-card"
      role="status"
    >
      <p className="font-semibold">Working on it…</p>
      <p className="text-sm text-muted">
        This page updates by itself. You can leave and come back.
      </p>
      <ol className="mt-5 space-y-4">
        {PROCESSING_STEPS.map((label, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'upcoming'
          return (
            <li
              key={label}
              data-step-state={state}
              className={`flex items-center gap-3 ${state === 'upcoming' ? 'text-muted' : ''}`}
            >
              {state === 'done' ? (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-sell text-white">
                  <Check size={14} />
                </span>
              ) : state === 'active' ? (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft">
                  <span className="pulse h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-line" />
              )}
              <span>
                <span className={state === 'active' || state === 'done' ? 'font-medium' : ''}>
                  {label}
                </span>
                {i === 0 && item.identified_name && (
                  <span className="text-sm text-muted"> · {item.identified_name}</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {stuck && (
        <p className="mt-4 text-sm text-warn">
          This is taking longer than expected. The pipeline may have
          gotten stuck -- feel free to check back later.
        </p>
      )}
    </div>
  )
}

// "Done something with it?" panel, shown only while the item is `decided`.
// The action matching the decision is the primary pill. On success the parent
// replaces its item with the PATCH response (status is no longer `decided`,
// so this panel unmounts); on failure the error shows and buttons re-enable.
function StatusActions({ item, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef(null)

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  async function handleClick(targetStatus) {
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError('')
    try {
      const updated = await patchItemStatus(item.id, targetStatus, controller.signal)
      if (controller.signal.aborted) return
      onUpdated(updated)
    } catch (err) {
      if (controller.signal.aborted || err.name === 'AbortError') return
      setError(err.message || 'Could not update status.')
      setBusy(false)
    }
  }

  const primaryStatus = DECISION_PRIMARY_STATUS[item.decision]
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl bg-sunken p-4">
      <p className="w-full text-sm text-muted">Done something with it?</p>
      {Object.entries(STATUS_ACTION_LABELS).map(([targetStatus, label]) => (
        <button
          key={targetStatus}
          type="button"
          disabled={busy}
          onClick={() => handleClick(targetStatus)}
          className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            targetStatus === primaryStatus
              ? 'border border-primary bg-primary text-white hover:bg-primary-hover'
              : 'border border-line bg-surface text-ink hover:bg-ground'
          }`}
        >
          {label}
        </button>
      ))}
      {error && (
        <div
          className="flex w-full gap-2.5 rounded-xl bg-toss-soft px-3.5 py-3 text-sm text-toss"
          role="alert"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/inventory"
      aria-label="Back to inventory"
      className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
    >
      <ChevronLeft size={16} />
      Inventory
    </Link>
  )
}

// How long the "Copied" / "Copy failed" feedback stays visible on a
// CopyButton before reverting to its normal label.
const COPY_FEEDBACK_MS = 2000

// A small button that copies `text` to the clipboard via the browser's
// `navigator.clipboard.writeText` API and shows brief "Copied" feedback
// (reverting after COPY_FEEDBACK_MS) on success, or "Copy failed" if the
// Clipboard API is missing (e.g. insecure context) or the write is rejected
// (e.g. permission denied). Used for the suggested title, description and
// search query independently -- each instance tracks its own state.
// The accessible name stays "Copy <label>" via aria-label regardless of the
// visible text; the outcome is announced through a polite live region.
function CopyButton({ text, label }) {
  const [feedback, setFeedback] = useState(null) // null | 'copied' | 'failed'
  const timeoutIdRef = useRef(null)

  useEffect(() => {
    // Clears any pending revert timer on unmount so it doesn't try to
    // setState on an unmounted component.
    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current)
    }
  }, [])

  async function handleClick() {
    let outcome = 'copied'
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Covers both a missing `navigator.clipboard` (TypeError) and a
      // rejected writeText promise.
      outcome = 'failed'
    }
    setFeedback(outcome)
    if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current)
    timeoutIdRef.current = setTimeout(() => setFeedback(null), COPY_FEEDBACK_MS)
  }

  const visible = feedback === 'copied' ? 'Copied' : feedback === 'failed' ? 'Copy failed' : 'Copy'
  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Copy ${label}`}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold hover:bg-sunken ${
          feedback === 'failed' ? 'text-toss' : feedback === 'copied' ? 'text-sell' : ''
        }`}
      >
        {feedback === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        {visible}
      </button>
      <span className="sr-only" aria-live="polite">
        {feedback === 'copied' ? 'Copied' : feedback === 'failed' ? 'Copy failed' : ''}
      </span>
    </>
  )
}

// Builds a best-effort link to Kleinanzeigen's public search results page
// for `query` (the exact `item.search_query_used` text, sandbox-b9a.1),
// following Kleinanzeigen's standard search URL pattern:
// https://www.kleinanzeigen.de/s-<slug>/k0, where <slug> is the query
// lowercased, with runs of whitespace collapsed and each word joined by a
// dash (e.g. "IKEA Schreibtischlampe" -> "ikea-schreibtischlampe"), each
// word individually percent-encoded via encodeURIComponent so any
// special characters in the query stay URL-safe.
//
// NOTE: this URL format could not be verified against the real site from
// this sandbox (kleinanzeigen.de is network-blocked here). If it turns out
// wrong once tested against the real site, only this function needs
// correcting -- not the rest of this feature's data plumbing.
export function buildKleinanzeigenSearchUrl(query) {
  const slug = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => encodeURIComponent(word))
    .join('-')
  return `https://www.kleinanzeigen.de/s-${slug}/k0`
}

async function fetchItem(id, signal) {
  const response = await apiFetch(`/items/${id}`, { signal })
  if (!response.ok) {
    // A 401 means the session expired while this page was open (e.g. in a
    // background tab) -- apiFetch (api.js) has already cleared the stale
    // token and dispatched SESSION_EXPIRED_EVENT, which AuthContext listens
    // for to flip the app back to the sign-in gate on its next render. This
    // still surfaces through the same `loadError` state as any other
    // fetch failure below (via poll()'s catch block), just with a message
    // that actually explains what happened rather than a generic
    // status-code string.
    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign in again.')
    }
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
  const pollStartRef = useRef(null)

  // Called unconditionally (before this component's early `loadError`/
  // `!item` returns below, per the rules of hooks) -- `item?.photo_url` is
  // `undefined` until the first successful poll response arrives, which
  // the hook already treats as "no photo yet, don't fetch" (see
  // useAuthedImageUrl.js).
  const photoObjectUrl = useAuthedImageUrl(item?.photo_url)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let intervalId

    pollStartRef.current = Date.now()
    setItem(null)
    setLoadError('')
    setStuck(false)

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
      <div className="mx-auto max-w-2xl">
        <BackLink />
        <div
          className="mt-4 flex gap-2.5 rounded-xl bg-toss-soft px-3.5 py-3 text-sm text-toss"
          role="alert"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <p>{loadError}</p>
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted" role="status">
          Loading item #{id}...
        </p>
      </div>
    )
  }

  const isTerminal = TERMINAL_STATUSES.includes(item.status)
  const isFailed = FAILED_STATUSES.includes(item.status)
  const decisionInfo = DECISION_INFO[item.decision] || DECISION_INFO.pending
  // Backend always sends an array today, but guard against `undefined`/
  // `null` (e.g. an older item, or a future backend change) so this page
  // never crashes on `.length`/`.map` below.
  const comparableListings = item.comparable_listings ?? []

  // Query for the listing card's "Open Kleinanzeigen" link: the exact query
  // the search used, else the identified name; no link if neither exists.
  const listingSearchQuery = (item.search_query_used || item.identified_name || '').trim()

  const photoAlt = item.identified_name
    ? `Photo of ${item.identified_name}`
    : `Photo of item #${item.id}`
  const showPill = isTerminal && !isFailed

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />

      <div className="mt-4 grid gap-5 sm:grid-cols-[13rem_1fr] sm:items-start">
        {/* Photo display: `Item.photo_url` (added in sandbox-yqf.19) is a
            relative path (e.g. "/uploads/<uuid>.jpg") served by the
            backend's StaticFiles mount, which now requires an Authorization
            header (sandbox-dfr.3) -- a plain `<img src>` can't attach one, so
            `useAuthedImageUrl` (sandbox-dfr.5) fetches the photo bytes
            authenticated via `apiFetch` and exposes them as a `blob:` object
            URL instead. While there's no `photo_url` yet, or the
            authenticated fetch hasn't resolved (or failed) yet,
            `photoObjectUrl` is `null` and a placeholder renders instead of a
            broken-image icon. */}
        {!item.photo_url ? (
          <div
            className="grid aspect-square w-full place-items-center rounded-2xl border border-dashed border-line bg-sunken p-4 text-center text-sm text-muted sm:w-52"
            data-testid="photo-placeholder"
          >
            <p>Photo unavailable.</p>
          </div>
        ) : photoObjectUrl ? (
          <img
            className="aspect-square w-full rounded-2xl bg-sunken object-cover shadow-card sm:w-52"
            src={photoObjectUrl}
            alt={photoAlt}
          />
        ) : (
          <div
            className="grid aspect-square w-full place-items-center rounded-2xl border border-dashed border-line bg-sunken p-4 text-center text-sm text-muted sm:w-52"
            data-testid="photo-placeholder"
          >
            <p>Loading photo...</p>
          </div>
        )}

        <div className="min-w-0">
          <h1 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Item #{item.id}
            {item.category ? ` · ${item.category}` : ''}
          </h1>
          {item.identified_name && (
            <h2 className="mt-1 font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {item.identified_name}
            </h2>
          )}
          {item.hint && <p className="mt-1.5 text-sm text-muted">Your hint: {item.hint}</p>}

          {showPill && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* Decision pill. role="status" + visible label text (not just
                  colour) so screen readers announce it and e2e can find it. */}
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${decisionInfo.className}`}
                role="status"
              >
                {decisionInfo.Icon && <decisionInfo.Icon size={15} />}
                {decisionInfo.label}
              </div>

              {/* Low-confidence pill (sandbox-8jm.6/.7) -- `decision_confidence`
                  is only ever "low" once a decision has been reached; "high"
                  or null/undefined (older items) renders nothing. */}
              {item.decision_confidence === 'low' && (
                <div
                  className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1 text-sm font-medium text-warn"
                  role="status"
                >
                  <AlertTriangle size={14} />
                  {item.decision === 'throw_away' && comparableListings.length === 0
                    ? 'No comparable listings found — double-check'
                    : 'Few comparable listings — double-check the price'}
                </div>
              )}
            </div>
          )}

          {showPill && item.decision === 'sell' && item.suggested_price != null && (
            <p className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tracking-tight tabular-nums">
                {formatPrice(item.suggested_price)}
              </span>
              <span className="text-sm text-muted">suggested price</span>
            </p>
          )}
        </div>
      </div>

      {!isTerminal && <ProcessingCard item={item} stuck={stuck} />}

      {/* `identification_failed`/`search_failed` (sandbox-khm.1) are
          terminal but never reach a real decision -- `item.decision` stays
          at the DB default (`pending`), so they get this distinct error card
          instead of the decision-pill/comparable-listings block below. */}
      {isFailed && (
        <div className="mt-8 rounded-2xl bg-toss-soft p-5 text-toss" role="alert">
          <p className="font-semibold">{FAILURE_MESSAGES[item.status]}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Retake photo
            </Link>
          </div>
        </div>
      )}

      {isTerminal && !isFailed && (
        <>
          {/* Suggested Kleinanzeigen title/description (sandbox-dwl.5) --
              only generated for sell/give_away decisions (see
              backend/app/pipeline.py), and only rendered here once both
              fields are non-empty strings, following the same
              conditionally-rendered-optional-field convention as
              `item.hint` above. Plain JSX text interpolation only (never
              dangerouslySetInnerHTML) since this is LLM-generated text. */}
          <div className="mt-6 space-y-6">
            <PricePosition
              decision={item.decision}
              suggestedPrice={item.suggested_price}
              comparableListings={comparableListings}
            />

            {(item.decision === 'sell' || item.decision === 'give_away') &&
              item.suggested_title &&
              item.suggested_description && (
                /* e2e (helpers/decision.js) walks heading -> parent -> `p`
                   descendants: title <p> first, description <p> second, so
                   the row labels are <span>s, not <p>s, and the heading and
                   the "Open Kleinanzeigen" link are direct children of this
                   card (a two-column grid) rather than wrapped in a header
                   div. */
                <div className="grid grid-cols-[1fr_auto] overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-card">
                  <h3
                    className={`border-b border-line px-5 py-3 font-semibold ${
                      listingSearchQuery ? '' : 'col-span-2'
                    }`}
                  >
                    Suggested Kleinanzeigen listing
                  </h3>
                  {listingSearchQuery && (
                    <a
                      href={buildKleinanzeigenSearchUrl(listingSearchQuery)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 border-b border-line px-5 py-3 text-sm font-medium text-primary hover:text-primary-hover"
                    >
                      Open Kleinanzeigen
                      <ExternalLink size={14} />
                    </a>
                  )}

                  <div className="col-span-2 divide-y divide-line">
                    <div className="flex items-start gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-muted">
                          Title
                        </span>
                        <p className="mt-1 font-medium">{item.suggested_title}</p>
                      </div>
                      <CopyButton text={item.suggested_title} label="title" />
                    </div>
                    <div className="flex items-start gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-muted">
                          Description
                        </span>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                          {item.suggested_description}
                        </p>
                      </div>
                      <CopyButton text={item.suggested_description} label="description" />
                    </div>
                  </div>
                </div>
              )}

            {/* The actual Kleinanzeigen search query used to find the
                comparable listings below (sandbox-b9a.1/.2) -- only rendered
                when a non-empty string, since a search may never have been
                attempted. Placed just above "Comparable listings" so it's
                clear which query produced them. */}
            {item.search_query_used && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-left">
                <p className="text-sm text-muted">
                  Searched:{' '}
                  <span className="font-mono text-xs text-ink">{item.search_query_used}</span>
                </p>
                <CopyButton text={item.search_query_used} label="search query" />
                <a
                  href={buildKleinanzeigenSearchUrl(item.search_query_used)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover"
                >
                  Search on Kleinanzeigen
                  <ExternalLink size={14} />
                </a>
              </div>
            )}

            <div className="text-left">
              <h3 className="font-semibold">Comparable listings</h3>
              {comparableListings.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No comparable listings found.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                  {comparableListings.map((listing) => (
                    /* DOM order is title, price, then condition/location:
                       e2e slices the <li> text after "EUR" to inspect the
                       condition, so the price must precede it in the DOM
                       even though the grid places the meta line below. */
                    <li
                      key={listing.id}
                      className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 px-4 py-3"
                    >
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        {listing.title}
                      </a>
                      <span className="text-right font-mono text-sm tabular-nums">
                        {typeof listing.price === 'number' ? `${listing.price.toFixed(2)} EUR` : ''}
                      </span>
                      <span className="text-sm text-muted">
                        {[listing.condition, listing.location].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {item.status === 'decided' && <StatusActions item={item} onUpdated={setItem} />}
          </div>
        </>
      )}

    </div>
  )
}

export default ItemResultPage

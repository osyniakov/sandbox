import { formatPrice } from './format.js'

const clampPercent = (v) => Math.min(100, Math.max(0, v))

// "Where €X sits" strip: shows the suggested price against the range of
// comparable listing prices. Renders nothing unless the decision is `sell`,
// a suggested price exists, and at least 2 comparables have numeric prices.
// The drawing is decorative (aria-hidden); a visually hidden sentence
// carries the same information for assistive tech.
function PricePosition({ decision, suggestedPrice, comparableListings }) {
  if (decision !== 'sell' || typeof suggestedPrice !== 'number' || !Number.isFinite(suggestedPrice)) {
    return null
  }
  const prices = (comparableListings ?? [])
    .map((l) => l?.price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p))
  if (prices.length < 2) return null

  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const pos = (v) => (max === min ? 50 : clampPercent(((v - min) / (max - min)) * 100))

  return (
    <div
      className="rounded-2xl border border-line bg-surface p-5 shadow-card"
      data-testid="price-position"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">Where {formatPrice(suggestedPrice)} sits</h3>
        <span className="text-sm tabular-nums text-muted">{prices.length} comparables</span>
      </div>
      <p className="sr-only">
        Suggested price {formatPrice(suggestedPrice)}; comparables range from {formatPrice(min)} to{' '}
        {formatPrice(max)}.
      </p>
      <div className="relative mt-6 h-12" aria-hidden="true">
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-sunken" />
        {prices.map((p, i) => (
          <span
            key={i}
            data-testid="price-dot"
            className="absolute top-[0.8rem] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-surface bg-muted"
            style={{ left: `${pos(p)}%` }}
          />
        ))}
        <div
          data-testid="price-marker"
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${pos(suggestedPrice)}%` }}
        >
          <div className="h-[1.375rem] w-1 rounded-full bg-primary" />
        </div>
        <div className="absolute inset-x-0 top-8 flex justify-between text-xs tabular-nums text-muted">
          <span>{formatPrice(min)}</span>
          <span>{formatPrice(max)}</span>
        </div>
      </div>
    </div>
  )
}

export default PricePosition

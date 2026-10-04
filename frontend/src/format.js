// "€35" for whole prices, "€45.50" otherwise.
const PRICE_FORMAT_WHOLE = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const PRICE_FORMAT_CENTS = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export function formatPrice(price) {
  return (Number.isInteger(price) ? PRICE_FORMAT_WHOLE : PRICE_FORMAT_CENTS).format(price)
}

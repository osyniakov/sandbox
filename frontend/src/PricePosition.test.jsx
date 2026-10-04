import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PricePosition from './PricePosition.jsx'

afterEach(cleanup)

const comps = (...prices) => prices.map((price, id) => ({ id, price }))

function renderStrip(props) {
  return render(
    <PricePosition decision="sell" suggestedPrice={35} comparableListings={comps(25, 45)} {...props} />,
  )
}

describe('PricePosition', () => {
  it('renders heading, count, dots, marker and a screen-reader sentence', () => {
    renderStrip({ comparableListings: comps(25, 30, 45) })
    expect(screen.getByRole('heading', { name: 'Where €35 sits' })).toBeInTheDocument()
    expect(screen.getByText('3 comparables')).toBeInTheDocument()
    expect(
      screen.getByText('Suggested price €35; comparables range from €25 to €45.'),
    ).toBeInTheDocument()
    const dots = screen.getAllByTestId('price-dot')
    expect(dots.map((d) => d.style.left)).toEqual(['0%', '25%', '100%'])
    expect(screen.getByTestId('price-marker').style.left).toBe('50%')
  })

  it('clamps the marker into [0, 100]%', () => {
    const { unmount } = renderStrip({ suggestedPrice: 5 })
    expect(screen.getByTestId('price-marker').style.left).toBe('0%')
    unmount()
    renderStrip({ suggestedPrice: 99 })
    expect(screen.getByTestId('price-marker').style.left).toBe('100%')
  })

  it('places everything at 50% when min equals max', () => {
    renderStrip({ comparableListings: comps(30, 30), suggestedPrice: 40 })
    screen.getAllByTestId('price-dot').forEach((d) => expect(d.style.left).toBe('50%'))
    expect(screen.getByTestId('price-marker').style.left).toBe('50%')
  })

  it('hides the decorative drawing from assistive tech', () => {
    renderStrip({})
    expect(screen.getByTestId('price-marker').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['non-sell decision', { decision: 'give_away' }],
    ['null suggested price', { suggestedPrice: null }],
    ['fewer than 2 comparables', { comparableListings: comps(30) }],
    ['fewer than 2 numeric prices', { comparableListings: [{ id: 1, price: 30 }, { id: 2, price: null }] }],
    ['missing comparables', { comparableListings: undefined }],
  ])('renders nothing for %s', (_name, props) => {
    const { container } = renderStrip(props)
    expect(container).toBeEmptyDOMElement()
  })
})

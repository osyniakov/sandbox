import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ItemResultPage from './ItemResultPage.jsx'

// Fixture Item records, one per backend `Decision` value plus one
// still-processing (non-terminal `status`) case -- matching the shape
// `_serialize_item` in backend/app/main.py actually returns.
const SELL_ITEM = {
  id: 1,
  photo_path: '/x/uploads/a.jpg',
  identified_name: 'Cordless Drill',
  category: 'Power Tools',
  brand: 'Bosch',
  condition: 'good',
  search_keywords: ['bosch', 'drill'],
  suggested_price: 45.5,
  decision: 'sell',
  status: 'decided',
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:05:00+00:00',
  comparable_listings: [
    {
      id: 10,
      title: 'Bosch cordless drill, good condition',
      price: 45,
      url: 'https://kleinanzeigen.example/1',
      condition: 'good',
      location: 'Berlin',
    },
    {
      id: 11,
      title: 'Bosch drill set',
      price: 46,
      url: 'https://kleinanzeigen.example/2',
      condition: 'good',
      location: 'Munich',
    },
  ],
}

const GIVE_AWAY_ITEM = {
  ...SELL_ITEM,
  id: 2,
  identified_name: 'Old Board Game',
  category: 'Toys & Games',
  suggested_price: 3,
  decision: 'give_away',
  comparable_listings: [
    {
      id: 20,
      title: 'Used board game',
      price: 3,
      url: 'https://kleinanzeigen.example/3',
      condition: 'used',
      location: 'Hamburg',
    },
  ],
}

const THROW_AWAY_ITEM = {
  ...SELL_ITEM,
  id: 3,
  identified_name: 'Broken Lamp',
  category: 'Lighting',
  condition: 'broken',
  suggested_price: null,
  decision: 'throw_away',
  comparable_listings: [],
}

const PROCESSING_ITEM = {
  id: 4,
  photo_path: '/x/uploads/d.jpg',
  identified_name: null,
  category: null,
  brand: null,
  condition: null,
  search_keywords: null,
  suggested_price: null,
  decision: 'pending',
  status: 'pending_identification',
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:00:00+00:00',
  comparable_listings: [],
}

function renderAtItem(id) {
  return render(
    <MemoryRouter initialEntries={[`/items/${id}`]}>
      <Routes>
        <Route path="/items/:id" element={<ItemResultPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ItemResultPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('renders the sell decision with suggested price and comparable listings', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => SELL_ITEM })

    renderAtItem(1)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cordless drill/i })).toBeInTheDocument()
    })

    expect(screen.getByText(/sell/i)).toBeInTheDocument()
    expect(screen.getByText(/45\.50/)).toBeInTheDocument()

    const links = screen.getAllByRole('link', { name: /bosch/i })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://kleinanzeigen.example/1')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders the give_away decision with comparable listings but no suggested price', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => GIVE_AWAY_ITEM })

    renderAtItem(2)

    await waitFor(() => {
      expect(screen.getByText(/old board game/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/give away/i)).toBeInTheDocument()
    // suggested_price is only shown for decision === 'sell'.
    expect(screen.queryByText(/suggested price/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /used board game/i })).toHaveAttribute(
      'href',
      'https://kleinanzeigen.example/3',
    )
  })

  it('renders the throw_away decision with no comparable listings and no suggested price', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => THROW_AWAY_ITEM })

    renderAtItem(3)

    await waitFor(() => {
      expect(screen.getByText(/broken lamp/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/throw away/i)).toBeInTheDocument()
    expect(screen.queryByText(/suggested price/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no comparable listings found/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(1) // just "Upload another photo"
  })

  it('shows a pending indicator (not broken/missing fields) while status is non-terminal', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => PROCESSING_ITEM })

    renderAtItem(4)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/still working on this item/i)
    })

    // None of the decided-only fields should render while pending.
    expect(screen.queryByText(/suggested price/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/comparable listings/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sell|give away|throw away/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
  })

  it('shows an error state when the item does not exist (404)', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ detail: 'No item with id 999.' }),
    })

    renderAtItem(999)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no item with id 999/i)
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhotoCarousel from './PhotoCarousel.jsx'
import { API_BASE_URL } from './api.js'
import { peekPhotoBlob } from './photoBlobCache.js'

vi.mock('./imageResize.js', () => ({
  prepareUploadImage: vi.fn(async (file) => file),
}))

function makeItem(count, extra = {}) {
  const photos = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    url: `/api/uploads/p${i + 1}.jpg`,
    position: i,
  }))
  return {
    id: 7,
    identified_name: 'Drill',
    photo_url: photos[0]?.url ?? null,
    photos,
    ...extra,
  }
}

const photoResponse = () => ({
  ok: true,
  status: 200,
  blob: async () => new Blob(['x'], { type: 'image/jpeg' }),
})

function mockFetch(handler) {
  fetch.mockImplementation((url, options) => {
    if (typeof url === 'string' && url.includes('/api/uploads/')) {
      return Promise.resolve(photoResponse())
    }
    return handler(url, options)
  })
}

describe('PhotoCarousel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('renders all photos in order with an indicator', async () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    render(<PhotoCarousel item={makeItem(3)} onItemChange={vi.fn()} />)
    const imgs = await screen.findAllByRole('img')
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
    expect(screen.getAllByRole('img').map((i) => i.alt)).toEqual([
      'Photo 1 of 3 of Drill',
      'Photo 2 of 3 of Drill',
      'Photo 3 of 3 of Drill',
    ])
    expect(imgs.length).toBeGreaterThan(0)
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('1 / 3')
  })

  it('updates the indicator with the next/previous buttons', async () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(3)} onItemChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('2 / 3')
    await user.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('1 / 3')
  })

  function mockGeometry(el, { scrollWidth, clientWidth, scrollLeft }) {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
    Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft })
  }

  it('shows M / M and disables Next when scrolled to the end', () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    render(<PhotoCarousel item={makeItem(4)} onItemChange={vi.fn()} />)
    const scroller = screen.getByTestId('photo-carousel')
    mockGeometry(scroller, { scrollWidth: 1168, clientWidth: 672, scrollLeft: 496 })
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('4 / 4')
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeEnabled()
  })

  it('steps back one photo at a time from the end despite clamped scroll positions', async () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(4)} onItemChange={vi.fn()} />)
    const scroller = screen.getByTestId('photo-carousel')
    const tiles = scroller.querySelectorAll('[data-photo-tile]')
    tiles.forEach((tile, i) => {
      Object.defineProperty(tile, 'offsetLeft', { configurable: true, value: i * 236 })
      Object.defineProperty(tile, 'offsetWidth', { configurable: true, value: 224 })
    })
    mockGeometry(scroller, { scrollWidth: 1168, clientWidth: 672, scrollLeft: 496 })
    scroller.scrollTo = vi.fn()
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('4 / 4')

    const prev = screen.getByRole('button', { name: 'Previous photo' })
    await user.click(prev)
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 472 }))
    mockGeometry(scroller, { scrollWidth: 1168, clientWidth: 672, scrollLeft: 260 })
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('3 / 4')

    await user.click(prev)
    mockGeometry(scroller, { scrollWidth: 1168, clientWidth: 672, scrollLeft: 236 })
    fireEvent.scroll(scroller)
    await user.click(prev)
    mockGeometry(scroller, { scrollWidth: 1168, clientWidth: 672, scrollLeft: 0 })
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('1 / 4')
    expect(prev).toBeDisabled()
  })

  it('reaches the last photo via Next when all tiles are already visible', async () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
    mockGeometry(screen.getByTestId('photo-carousel'), {
      scrollWidth: 700,
      clientWidth: 700,
      scrollLeft: 0,
    })
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByTestId('photo-indicator')).toHaveTextContent('2 / 2')
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled()
  })

  it('falls back to photo_url when photos is missing (no Remove)', async () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    const item = { id: 1, identified_name: 'Lamp', photo_url: '/api/uploads/a.jpg' }
    render(<PhotoCarousel item={item} onItemChange={vi.fn()} />)
    expect(await screen.findByRole('img')).toHaveAttribute('alt', 'Photo 1 of 1 of Lamp')
    expect(screen.queryByRole('button', { name: /remove photo/i })).not.toBeInTheDocument()
  })

  it('adds photos and reports the returned item', async () => {
    const updated = makeItem(3)
    mockFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => updated }))
    const onItemChange = vi.fn()
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(2)} onItemChange={onItemChange} />)
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByTestId('add-photo-input'), file)
    await waitFor(() => expect(onItemChange).toHaveBeenCalledWith(updated))
    const call = fetch.mock.calls.find(([url]) => url === `${API_BASE_URL}/api/items/7/photos`)
    expect(call[1].method).toBe('POST')
    expect(call[1].body.getAll('photos')).toHaveLength(1)
  })

  it('shows the server error when adding fails with 400', async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ detail: 'At most 10 photos per item.' }),
      }),
    )
    const onItemChange = vi.fn()
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(2)} onItemChange={onItemChange} />)
    await user.upload(
      screen.getByTestId('add-photo-input'),
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('At most 10 photos per item.')
    expect(onItemChange).not.toHaveBeenCalled()
  })

  it('hides the add tile at 10 photos', () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    render(<PhotoCarousel item={makeItem(10)} onItemChange={vi.fn()} />)
    expect(screen.queryByTestId('add-photo-input')).not.toBeInTheDocument()
    expect(screen.queryByText('Add photo')).not.toBeInTheDocument()
  })

  it('removes a photo after confirmation', async () => {
    const updated = makeItem(1)
    mockFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => updated }))
    const onItemChange = vi.fn()
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(2)} onItemChange={onItemChange} />)
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    expect(screen.getByText('Remove this photo?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onItemChange).toHaveBeenCalledWith(updated))
    const call = fetch.mock.calls.find(([, o]) => o?.method === 'DELETE')
    expect(call[0]).toBe(`${API_BASE_URL}/api/items/7/photos/2`)
  })

  it('shows the error when removal fails with 409', async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ detail: 'Cannot remove the last photo.' }),
      }),
    )
    const user = userEvent.setup()
    render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot remove the last photo.')
  })

  it('hides Remove for a single photo and for a null photo id', () => {
    mockFetch(() => Promise.reject(new Error('unexpected')))
    const { rerender } = render(<PhotoCarousel item={makeItem(1)} onItemChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /remove photo/i })).not.toBeInTheDocument()
    const legacy = makeItem(2)
    legacy.photos[0].id = null
    rerender(<PhotoCarousel item={legacy} onItemChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Remove photo 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo 2' })).toBeInTheDocument()
  })

  describe('saving', () => {
    let downloads
    beforeEach(() => {
      downloads = []
      URL.createObjectURL = vi.fn(() => 'blob:x')
      URL.revokeObjectURL = vi.fn()
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        downloads.push(this.download)
      })
    })
    afterEach(() => {
      vi.restoreAllMocks()
      delete navigator.share
      delete navigator.canShare
    })

    it('Save photo N shares that single file', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      navigator.canShare = () => true
      navigator.share = vi.fn().mockResolvedValue()
      const user = userEvent.setup()
      render(<PhotoCarousel item={makeItem(3, { identified_name: 'Bohrmaschine Größe' })} onItemChange={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Save photo 2' }))
      await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1))
      const { files } = navigator.share.mock.calls[0][0]
      expect(files.map((f) => f.name)).toEqual(['bohrmaschine-groesse-2.jpg'])
    })

    it('Save all shares every file; hidden for a single photo; works for null ids', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      navigator.canShare = () => true
      navigator.share = vi.fn().mockResolvedValue()
      const user = userEvent.setup()
      const legacy = makeItem(2, { identified_name: null })
      legacy.photos.forEach((p) => { p.id = null })
      const { rerender } = render(<PhotoCarousel item={legacy} onItemChange={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Save all photos' }))
      await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1))
      expect(navigator.share.mock.calls[0][0].files.map((f) => f.name)).toEqual(['item-7-1.jpg', 'item-7-2.jpg'])
      rerender(<PhotoCarousel item={makeItem(1)} onItemChange={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Save all photos' })).not.toBeInTheDocument()
    })

    it('downloads when share is unavailable', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      const user = userEvent.setup()
      render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Save all photos' }))
      await waitFor(() => expect(downloads).toEqual(['drill-1.jpg', 'drill-2.jpg']))
    })

    it('shows an alert and re-enables buttons when the fetch fails', async () => {
      fetch.mockImplementation((url) =>
        url.includes('p2.jpg')
          ? Promise.resolve({ ok: false, status: 500 })
          : Promise.resolve(photoResponse()),
      )
      const user = userEvent.setup()
      render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Save photo 2' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
      expect(screen.getByRole('button', { name: 'Save photo 2' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Save all photos' })).toBeEnabled()
    })

    it('shares synchronously from prefetched files without refetching', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      navigator.canShare = () => true
      navigator.share = vi.fn().mockResolvedValue()
      render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
      await waitFor(() => expect(fetch.mock.calls.filter((c) => c[0].includes('/api/uploads/')).length).toBeGreaterThanOrEqual(2))
      await new Promise((r) => setTimeout(r, 50))
      const before = fetch.mock.calls.length
      fireEvent.click(screen.getByRole('button', { name: 'Save all photos' }))
      expect(navigator.share).toHaveBeenCalledTimes(1)
      expect(navigator.share.mock.calls[0][0].files.map((f) => f.name)).toEqual(['drill-1.jpg', 'drill-2.jpg'])
      expect(fetch.mock.calls.length).toBe(before)
    })

    it('makes one fetch per photo with display and Save prefetch both active', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      navigator.canShare = () => true
      navigator.share = vi.fn().mockResolvedValue()
      render(<PhotoCarousel item={makeItem(3)} onItemChange={vi.fn()} />)
      await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(3))
      const uploads = fetch.mock.calls.filter((c) => c[0].includes('/api/uploads/')).map((c) => c[0])
      expect(uploads).toHaveLength(3)
      expect(new Set(uploads).size).toBe(3)
    })

    it('does not re-cache a photo removed while its Save fetch was in flight', async () => {
      const releases = []
      fetch.mockImplementation(
        (url) =>
          new Promise((resolve) => {
            if (url.includes('/api/uploads/')) releases.push(() => resolve(photoResponse()))
            else resolve({ ok: true, status: 200, json: async () => makeItem(1) })
          }),
      )
      const user = userEvent.setup()
      const onItemChange = vi.fn()
      render(<PhotoCarousel item={makeItem(2)} onItemChange={onItemChange} />)
      await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(onItemChange).toHaveBeenCalled())
      releases.forEach((r) => r())
      await new Promise((r) => setTimeout(r, 20))
      expect(peekPhotoBlob('/api/uploads/p1.jpg')).toBeUndefined()
    })

    it('shows a tap-again status, without downloading, on NotAllowedError after awaiting', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      navigator.canShare = () => true
      navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('n'), { name: 'NotAllowedError' }))
      render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Save all photos' }))
      expect(await screen.findByRole('status')).toHaveTextContent(/tap Save again/)
      expect(downloads).toEqual([])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not prefetch when canShare is undefined', async () => {
      mockFetch(() => Promise.reject(new Error('unexpected')))
      render(<PhotoCarousel item={makeItem(2)} onItemChange={vi.fn()} />)
      await new Promise((r) => setTimeout(r, 30))
      expect(fetch.mock.calls.filter((c) => c[0].includes('/api/uploads/')).length).toBe(2) // images only
      fireEvent.click(screen.getByRole('button', { name: 'Save photo 1' }))
      await waitFor(() => expect(downloads).toEqual(['drill-1.jpg']))
    })

    it('caches click-time fetches after a failed prefetch so the second tap shares synchronously', async () => {
      let fail = true
      fetch.mockImplementation((url) =>
        fail && url.includes('p1.jpg') ? Promise.reject(new Error('net')) : Promise.resolve(photoResponse()),
      )
      navigator.canShare = () => true
      navigator.share = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('n'), { name: 'NotAllowedError' }))
        .mockResolvedValue()
      render(<PhotoCarousel item={makeItem(1)} onItemChange={vi.fn()} />)
      await new Promise((r) => setTimeout(r, 30))
      fail = false
      fireEvent.click(screen.getByRole('button', { name: 'Save photo 1' }))
      expect(await screen.findByRole('status')).toHaveTextContent(/tap Save again/)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save photo 1' })).toBeEnabled())
      const before = fetch.mock.calls.length
      fireEvent.click(screen.getByRole('button', { name: 'Save photo 1' }))
      expect(navigator.share).toHaveBeenCalledTimes(2)
      expect(fetch.mock.calls.length).toBe(before)
    })
  })
})

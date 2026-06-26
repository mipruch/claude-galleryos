import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { isRtspUrl, playlistUrl, sortByDisplayOrder, stopUrl } from '@/lib/cameras'
import { useCamerasStore } from '@/stores/cameras'
import { makeCamera } from './fixtures'

// Mock the REST client so the store test never hits the network.
vi.mock('@/lib/api', () => ({
  api: { cameras: { list: vi.fn() } },
}))
// Silence the toast side-effects.
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { api } from '@/lib/api'

describe('isRtspUrl', () => {
  it('accepts rtsp(s) URLs', () => {
    for (const u of ['rtsp://10.0.0.1:554/stream', 'rtsps://cam.local/Streaming/Channels/101'])
      expect(isRtspUrl(u)).toBe(true)
  })

  it('rejects empty, relative, or non-rtsp URLs', () => {
    for (const u of ['', '/stream', 'http://host/stream', 'cam.local/s', 'not a url'])
      expect(isRtspUrl(u)).toBe(false)
  })
})

describe('stream URLs', () => {
  it('builds playlist and stop URLs from the camera id', () => {
    expect(playlistUrl('abc')).toBe('/api/v1/cameras/abc/stream.m3u8')
    expect(stopUrl('abc')).toBe('/api/v1/cameras/abc/stop')
  })
})

describe('sortByDisplayOrder', () => {
  it('orders by displayOrder ascending, breaking ties on name', () => {
    const a = makeCamera({ id: 'a', name: 'Zebra', displayOrder: 1 })
    const b = makeCamera({ id: 'b', name: 'Apple', displayOrder: 0 })
    const c = makeCamera({ id: 'c', name: 'Mango', displayOrder: 0 })
    expect(sortByDisplayOrder([a, b, c]).map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const list = [makeCamera({ id: 'a', displayOrder: 2 }), makeCamera({ id: 'b', displayOrder: 1 })]
    const before = list.map((f) => f.id)
    sortByDisplayOrder(list)
    expect(list.map((f) => f.id)).toEqual(before)
  })
})

describe('useCamerasStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads cameras sorted by display order and exposes byId', async () => {
    vi.mocked(api.cameras.list).mockResolvedValue([
      makeCamera({ id: 'b', name: 'Foyer', displayOrder: 1 }),
      makeCamera({ id: 'a', name: 'Hall', displayOrder: 0 }),
    ])
    const store = useCamerasStore()
    await store.fetchAll()
    expect(store.records.map((c) => c.id)).toEqual(['a', 'b'])
    expect(store.loaded).toBe(true)
    expect(store.byId('b')?.name).toBe('Foyer')
    expect(store.byId('missing')).toBeUndefined()
  })

  it('records an error when the list request fails', async () => {
    vi.mocked(api.cameras.list).mockRejectedValue(new Error('boom'))
    const store = useCamerasStore()
    await store.fetchAll()
    expect(store.error).toBe('boom')
    expect(store.records).toEqual([])
    expect(store.loaded).toBe(false)
  })
})

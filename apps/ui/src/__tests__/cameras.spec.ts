import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { computeCameraReorder, isRtspUrl, playlistUrl, sortByDisplayOrder, stopUrl } from '@/lib/cameras'
import { useCamerasStore } from '@/stores/cameras'
import { makeCamera } from './fixtures'

// Mock the REST client so the store test never hits the network.
vi.mock('@/lib/api', () => ({
  api: {
    cameras: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  },
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

describe('computeCameraReorder', () => {
  const list = [
    makeCamera({ id: 'a', name: 'Alpha', displayOrder: 0 }),
    makeCamera({ id: 'b', name: 'Bravo', displayOrder: 1 }),
    makeCamera({ id: 'c', name: 'Charlie', displayOrder: 2 }),
  ]

  it('moves a camera up and renumbers only the swapped pair', () => {
    const result = computeCameraReorder(list, 'b', -1)
    expect(result?.order.map((c) => c.id)).toEqual(['b', 'a', 'c'])
    expect(result?.changed).toEqual(
      expect.arrayContaining([
        { id: 'a', displayOrder: 1 },
        { id: 'b', displayOrder: 0 },
      ]),
    )
    expect(result?.changed).toHaveLength(2)
  })

  it('moves a camera down', () => {
    const result = computeCameraReorder(list, 'a', 1)
    expect(result?.order.map((c) => c.id)).toEqual(['b', 'a', 'c'])
  })

  it('returns null for an out-of-range move or unknown id', () => {
    expect(computeCameraReorder(list, 'a', -1)).toBeNull()
    expect(computeCameraReorder(list, 'c', 1)).toBeNull()
    expect(computeCameraReorder(list, 'missing', 1)).toBeNull()
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

  it('creates a camera and inserts it in display-order position', async () => {
    const created = makeCamera({ id: 'new', name: 'New cam', displayOrder: 0 })
    vi.mocked(api.cameras.create).mockResolvedValue(created)
    const store = useCamerasStore()
    const result = await store.create({ name: 'New cam', url: created.url })
    expect(result).toEqual(created)
    expect(store.records.map((c) => c.id)).toEqual(['new'])
  })

  it('returns null and keeps records untouched when create fails', async () => {
    vi.mocked(api.cameras.create).mockRejectedValue(new Error('boom'))
    const store = useCamerasStore()
    const result = await store.create({ name: 'New cam', url: 'rtsp://host/s' })
    expect(result).toBeNull()
    expect(store.records).toEqual([])
  })

  it('updates a camera in place', async () => {
    vi.mocked(api.cameras.list).mockResolvedValue([makeCamera({ id: 'a', name: 'Hall' })])
    const store = useCamerasStore()
    await store.fetchAll()

    const updated = makeCamera({ id: 'a', name: 'Main Hall' })
    vi.mocked(api.cameras.update).mockResolvedValue(updated)
    const ok = await store.update('a', { name: 'Main Hall' })
    expect(ok).toBe(true)
    expect(store.byId('a')?.name).toBe('Main Hall')
  })

  it('returns false when update fails', async () => {
    vi.mocked(api.cameras.list).mockResolvedValue([makeCamera({ id: 'a' })])
    const store = useCamerasStore()
    await store.fetchAll()

    vi.mocked(api.cameras.update).mockRejectedValue(new Error('boom'))
    const ok = await store.update('a', { name: 'Renamed' })
    expect(ok).toBe(false)
  })

  it('removes a camera', async () => {
    vi.mocked(api.cameras.list).mockResolvedValue([makeCamera({ id: 'a' }), makeCamera({ id: 'b' })])
    const store = useCamerasStore()
    await store.fetchAll()

    vi.mocked(api.cameras.remove).mockResolvedValue(null)
    const ok = await store.remove('a')
    expect(ok).toBe(true)
    expect(store.records.map((c) => c.id)).toEqual(['b'])
  })

  it('returns false and keeps the row when delete fails', async () => {
    vi.mocked(api.cameras.list).mockResolvedValue([makeCamera({ id: 'a' })])
    const store = useCamerasStore()
    await store.fetchAll()

    vi.mocked(api.cameras.remove).mockRejectedValue(new Error('boom'))
    const ok = await store.remove('a')
    expect(ok).toBe(false)
    expect(store.records.map((c) => c.id)).toEqual(['a'])
  })

  it('moves a camera and persists only the changed rows', async () => {
    vi.mocked(api.cameras.list).mockResolvedValue([
      makeCamera({ id: 'a', name: 'Alpha', displayOrder: 0 }),
      makeCamera({ id: 'b', name: 'Bravo', displayOrder: 1 }),
    ])
    const store = useCamerasStore()
    await store.fetchAll()

    vi.mocked(api.cameras.update).mockResolvedValue(null as never)
    await store.move('b', -1)

    expect(store.records.map((c) => c.id)).toEqual(['b', 'a'])
    expect(api.cameras.update).toHaveBeenCalledWith('a', { displayOrder: 1 })
    expect(api.cameras.update).toHaveBeenCalledWith('b', { displayOrder: 0 })
  })

  it('reverts via refetch when persisting a move fails', async () => {
    vi.mocked(api.cameras.list).mockResolvedValueOnce([
      makeCamera({ id: 'a', name: 'Alpha', displayOrder: 0 }),
      makeCamera({ id: 'b', name: 'Bravo', displayOrder: 1 }),
    ])
    const store = useCamerasStore()
    await store.fetchAll()

    vi.mocked(api.cameras.update).mockRejectedValue(new Error('boom'))
    vi.mocked(api.cameras.list).mockResolvedValueOnce([
      makeCamera({ id: 'a', name: 'Alpha', displayOrder: 0 }),
      makeCamera({ id: 'b', name: 'Bravo', displayOrder: 1 }),
    ])
    await store.move('b', -1)

    expect(store.records.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RoomDTO } from '@gallery/types'
import { useDevicesStore } from '@/stores/devices'
import type { DeviceRecord } from '@/lib/devices'
import { makeDevice, makeRoom } from './fixtures'

beforeAll(() => {
  // The store opens a WebSocket lazily; stub the global so setup never throws.
  globalThis.WebSocket = class {
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  } as unknown as typeof WebSocket
  globalThis.fetch = vi.fn<() => Promise<unknown>>().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch
})

beforeEach(() => setActivePinia(createPinia()))

function dev(id: string, roomId: string | null, type = 'light'): DeviceRecord {
  return makeDevice({ id, name: id, roomId, type, subtype: 'dali.fixture' })
}

function room(id: string, name: string): RoomDTO {
  return makeRoom({ id, name })
}

describe('devices store — room scope', () => {
  it('counts devices per room across all devices', () => {
    const store = useDevicesStore()
    store.records = [dev('a', 'r1'), dev('b', 'r2'), dev('c', 'r1'), dev('d', null)]
    expect(store.roomDeviceCounts).toEqual({ r1: 2, r2: 1 })
  })

  it('scopes the grid to a room while leaving the global device list intact', () => {
    const store = useDevicesStore()
    store.records = [dev('a', 'r1'), dev('b', 'r2'), dev('c', null)]
    store.rooms = [room('r1', 'Hall')]

    // Home: everything.
    expect(store.scopedDevices.map((d) => d.id)).toEqual(['a', 'b', 'c'])

    store.setRoomScope('r1')
    expect(store.roomScope).toBe('r1')
    expect(store.currentRoom?.name).toBe('Hall')
    expect(store.scopedDevices.map((d) => d.id)).toEqual(['a'])
    // `devices` (used by the command palette) stays global.
    expect(store.devices.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('resets group/filters/search when the scope changes', () => {
    const store = useDevicesStore()
    store.records = [dev('a', 'r1')]
    store.setGroupMode('type')
    store.toggleType('light')
    store.search = 'proj'

    store.setRoomScope('r1')
    expect(store.groupMode).toBe('off')
    expect(store.typeFilter).toEqual([])
    expect(store.search).toBe('')
  })
})

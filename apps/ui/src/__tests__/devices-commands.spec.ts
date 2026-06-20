/**
 * Optimistic-command machinery of the devices store — the riskiest FE code, and
 * previously untested. Drives the store against a fake realtime socket so we can
 * fire acks and toggle connectivity deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import type { DeviceRecord, DeviceState } from '@/lib/devices'

// Fake realtime store: a real ref for `connected` (so the store's watcher fires),
// a handler registry we can invoke, and a record of what was sent.
vi.mock('@/stores/realtime', async () => {
  const { ref } = await import('vue')
  const g = globalThis as unknown as Record<string, unknown>
  g.__rtConnected = ref(true)
  g.__rtHandlers = new Map<string, (d: unknown) => void>()
  g.__rtSends = [] as unknown[]
  return {
    useRealtimeStore: () => ({
      get connected() {
        return (g.__rtConnected as { value: boolean }).value
      },
      on: (event: string, handler: (d: unknown) => void) => {
        ;(g.__rtHandlers as Map<string, unknown>).set(event, handler)
        return () => {}
      },
      send: (msg: unknown) => (g.__rtSends as unknown[]).push(msg),
      open() {},
      close() {},
    }),
  }
})

// Toasts are side effects we don't want to render; spy so we can assert on them.
vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

const g = globalThis as unknown as {
  __rtConnected: { value: boolean }
  __rtHandlers: Map<string, (d: unknown) => void>
  __rtSends: Array<{ event: string; data: Record<string, unknown> }>
}

const fireAck = (data: Record<string, unknown>): void =>
  g.__rtHandlers.get('device:command:ack')?.(data)

function dev(id: string): DeviceRecord {
  return { id, name: id.toUpperCase(), enabled: true, displayOrder: 0, type: 'light', subtype: 'dali.fixture' } as unknown as DeviceRecord
}

function setup(initial: Record<string, DeviceState> = {}) {
  setActivePinia(createPinia())
  const store = useDevicesStore()
  store.records = [dev('d1'), dev('d2')]
  for (const [id, state] of Object.entries(initial)) store.states[id] = state
  return store
}

beforeEach(() => {
  g.__rtConnected.value = true
  g.__rtSends.length = 0
})

describe('devices store — optimistic commands', () => {
  it('applies the optimistic patch immediately and adopts authoritative ack state', async () => {
    const store = setup()
    const p = store.sendCommand('d1', 'setLevel', { level: 0.5 }, { level: 0.5 })

    // Optimistic value visible at once; command was sent over the socket.
    expect(store.stateOf('d1').level).toBe(0.5)
    expect(g.__rtSends[g.__rtSends.length - 1]).toMatchObject({
      event: 'device:command',
      data: { deviceId: 'd1', command: 'setLevel' },
    })

    fireAck({ deviceId: 'd1', success: true, state: { level: 0.5, muted: false } })
    expect(await p).toBe(true)
    // Authoritative fields are merged in.
    expect(store.stateOf('d1')).toMatchObject({ level: 0.5, muted: false })
  })

  it('reverts the optimistic patch and resolves false on a failed ack', async () => {
    const { toast } = await import('vue-sonner')
    const store = setup({ d1: { level: 0.2 } })
    const p = store.sendCommand('d1', 'setLevel', { level: 0.9 }, { level: 0.9 })
    expect(store.stateOf('d1').level).toBe(0.9) // optimistic

    fireAck({ deviceId: 'd1', success: false, error: 'device refused' })
    expect(await p).toBe(false)
    expect(store.stateOf('d1').level).toBe(0.2) // reverted
    expect(toast.error).toHaveBeenCalled()
  })

  it('resolves per-device commands FIFO', async () => {
    const store = setup()
    const order: string[] = []
    const p1 = store.sendCommand('d1', 'a', {}, { x: 1 }).then(() => order.push('p1'))
    const p2 = store.sendCommand('d1', 'b', {}, { x: 2 }).then(() => order.push('p2'))

    fireAck({ deviceId: 'd1', success: true }) // first in-flight
    fireAck({ deviceId: 'd1', success: true }) // second
    await Promise.all([p1, p2])
    expect(order).toEqual(['p1', 'p2'])
  })

  it('does not send and resolves false when offline', async () => {
    const store = setup()
    g.__rtConnected.value = false
    await nextTick()
    expect(await store.sendCommand('d1', 'on', {}, { on: true })).toBe(false)
    expect(g.__rtSends).toHaveLength(0)
  })

  it('a dropped socket resolves outstanding commands as failed, without reverting', async () => {
    const store = setup({ d1: { level: 0.3 } })
    const p = store.sendCommand('d1', 'setLevel', { level: 0.8 }, { level: 0.8 })
    expect(store.stateOf('d1').level).toBe(0.8) // optimistic applied

    g.__rtConnected.value = false // socket drops before the ack arrives
    await nextTick()

    expect(await p).toBe(false)
    // Outcome unknown → keep the optimistic value rather than reverting.
    expect(store.stateOf('d1').level).toBe(0.8)
  })
})

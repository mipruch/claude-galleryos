/**
 * DeviceSheet tests — what the device sheet does *around* the grid: which rows
 * it shows, which columns it grows when scoped to a driver, and what it posts.
 * The interactions themselves live in `sheetGrid.spec.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DriverManifest } from '@gallery/driver-core'
import DeviceSheet from '@/components/admin/bulk/DeviceSheet.vue'
import { api } from '@/lib/api'

const samsung: DriverManifest = {
  id: 'samsung-mdc',
  name: 'Samsung MDC Display',
  version: '0.1.0',
  vendor: 'Samsung',
  connectionSchema: {
    type: 'object',
    required: ['host'],
    properties: {
      host: { type: 'string', title: 'Host / IP' },
      port: { type: 'integer', title: 'Port', default: 1515 },
    },
  },
  capabilities: { discovery: false, subscriptions: false, bidirectional: true },
  soloEndpointType: 'samsung-mdc.display',
  endpointTypes: [
    {
      type: 'samsung-mdc.display',
      name: 'Display',
      addressSchema: {
        type: 'object',
        required: ['displayId'],
        properties: { displayId: { type: 'integer', title: 'Display ID', default: 1 } },
      },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

const netio: DriverManifest = {
  ...samsung,
  id: 'netio',
  name: 'NETIO',
  soloEndpointType: undefined,
  endpointTypes: [
    {
      type: 'netio.socket',
      name: 'Power Socket',
      addressSchema: {
        type: 'object',
        required: ['outputId'],
        properties: { outputId: { type: 'integer', title: 'Output ID' } },
      },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

vi.mock('@/lib/api', () => ({
  api: {
    drivers: { list: vi.fn<() => Promise<unknown>>() },
    devices: { list: vi.fn<() => Promise<unknown>>(), live: vi.fn<() => Promise<unknown>>() },
    rooms: { list: vi.fn<() => Promise<unknown>>() },
    iframes: { list: vi.fn<() => Promise<unknown>>() },
    connections: { list: vi.fn<() => Promise<unknown>>(), live: vi.fn<() => Promise<unknown>>() },
    bulk: {
      applyDevices: vi.fn<() => Promise<unknown>>(),
      deleteDevices: vi.fn<() => Promise<unknown>>(),
    },
  },
}))
vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>(), warning: vi.fn<() => void>() },
}))

const mocked = api as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const CONNECTIONS = [
  {
    id: 'c1',
    name: 'Wall 1',
    driverId: 'samsung-mdc',
    host: '10.0.1.1',
    port: 1515,
    config: {},
    enabled: true,
  },
  {
    id: 'c2',
    name: 'Hall 1 — Netio 2',
    driverId: 'netio',
    host: '10.0.2.1',
    config: {},
    enabled: true,
  },
]
const DEVICES = [
  {
    id: 'd1',
    connectionId: 'c1',
    name: 'Displej 01',
    type: 'display',
    subtype: 'samsung-mdc.display',
    address: { displayId: 1 },
    roomId: null,
    enabled: true,
  },
  {
    id: 'd2',
    connectionId: 'c2',
    name: 'Panel lighting',
    type: 'power',
    subtype: 'netio.socket',
    address: { outputId: 3 },
    roomId: null,
    enabled: true,
  },
]

beforeAll(() => {
  globalThis.WebSocket = class {
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  } as unknown as typeof WebSocket
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocked.drivers!.list!.mockResolvedValue([samsung, netio])
  mocked.devices!.list!.mockResolvedValue(DEVICES)
  mocked.devices!.live!.mockResolvedValue({})
  mocked.rooms!.list!.mockResolvedValue([{ id: 'r1', name: 'Hall A', displayOrder: 0 }])
  mocked.iframes!.list!.mockResolvedValue([])
  mocked.connections!.list!.mockResolvedValue(CONNECTIONS)
  mocked.connections!.live!.mockResolvedValue({})
  mocked.bulk!.applyDevices!.mockResolvedValue({
    ok: true,
    dryRun: false,
    created: 0,
    updated: 0,
    errors: [],
    rows: [],
  })
})

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const headers = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('thead th').map((th) => th.text().replace('*', '').trim())

const bodyText = (wrapper: VueWrapper): string => wrapper.find('tbody').text()

describe('DeviceSheet', () => {
  it('opens with every device in it — no driver has to be chosen first', async () => {
    const wrapper = mount(DeviceSheet, { attachTo: document.body })
    await flush()

    // Both devices are there despite being on different drivers…
    expect(bodyText(wrapper)).toContain('Displej 01')
    expect(bodyText(wrapper)).toContain('Panel lighting')
    // …with the columns that apply to any device, including its connection.
    expect(headers(wrapper)).toEqual(
      expect.arrayContaining(['Name', 'Connection', 'Type', 'Room', 'Enabled']),
    )
  })

  it('grows addressing columns once scoped to a driver', async () => {
    const wrapper = mount(DeviceSheet, { attachTo: document.body })
    await flush()
    expect(headers(wrapper)).not.toContain('Display ID')

    await wrapper.find('#sheet-driver').setValue('samsung-mdc')
    await flush()

    // A 1:1 driver brings its connection's columns along with the address.
    expect(headers(wrapper)).toEqual(
      expect.arrayContaining(['Name', 'Connection name', 'Host / IP', 'Display ID']),
    )
    // …and narrows to that driver's devices.
    expect(bodyText(wrapper)).toContain('Displej 01')
    expect(bodyText(wrapper)).not.toContain('Panel lighting')
  })

  it('posts a scoped 1:1 row with its connection nested inside', async () => {
    const wrapper = mount(DeviceSheet, { attachTo: document.body })
    await flush()
    await wrapper.find('#sheet-driver').setValue('samsung-mdc')
    await flush()

    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    sheet.rows[0]!.values.name = 'Displej 01 renamed'
    await flush()
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Save'))!
      .trigger('click')
    await flush()

    expect(mocked.bulk!.applyDevices!).toHaveBeenCalledTimes(1)
    const [payload] = mocked.bulk!.applyDevices!.mock.calls[0] as [
      { rows: Record<string, unknown>[] },
    ]
    expect(payload.rows[0]).toMatchObject({
      deviceId: 'd1',
      name: 'Displej 01 renamed',
      subtype: 'samsung-mdc.display',
      connection: { id: 'c1', host: '10.0.1.1' },
    })
  })

  it('marks the cells a rejected batch names and reports that nothing was written', async () => {
    mocked.bulk!.applyDevices!.mockResolvedValue({
      ok: false,
      dryRun: false,
      created: 0,
      updated: 0,
      rows: [],
      errors: [{ row: 0, field: 'name', message: 'name is required' }],
    })

    const wrapper = mount(DeviceSheet, { attachTo: document.body })
    await flush()
    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    sheet.rows[0]!.values.name = ''
    await flush()
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Save'))!
      .trigger('click')
    await flush()

    expect(wrapper.text()).toContain('nothing was written')
    expect(wrapper.findAll('tbody td.invalid').length).toBeGreaterThan(0)
  })
})

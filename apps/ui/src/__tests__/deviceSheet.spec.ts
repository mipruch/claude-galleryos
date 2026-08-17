/**
 * DeviceSheet mount tests — the grid actually rendering and reacting.
 *
 * `bulkSheet.spec.ts` covers the logic; this covers the wiring the logic can't:
 * that columns reach the DOM for a 1:1 driver, that "Add rows" continues the
 * series into real cells, that a paste event fills a block, and that saving
 * posts one batch. Everything below the component (`api`, the sockets) is
 * stubbed — this is about the component, not the transport.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DriverManifest } from '@gallery/driver-core'
import DeviceSheet from '@/components/admin/bulk/DeviceSheet.vue'
import { api } from '@/lib/api'

const manifest: DriverManifest = {
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

const mocked = api as unknown as {
  drivers: { list: ReturnType<typeof vi.fn> }
  devices: { list: ReturnType<typeof vi.fn>; live: ReturnType<typeof vi.fn> }
  rooms: { list: ReturnType<typeof vi.fn> }
  iframes: { list: ReturnType<typeof vi.fn> }
  connections: { list: ReturnType<typeof vi.fn>; live: ReturnType<typeof vi.fn> }
  bulk: { applyDevices: ReturnType<typeof vi.fn>; deleteDevices: ReturnType<typeof vi.fn> }
}

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
  mocked.drivers.list.mockResolvedValue([manifest])
  mocked.devices.list.mockResolvedValue([])
  mocked.devices.live.mockResolvedValue({})
  mocked.rooms.list.mockResolvedValue([{ id: 'r1', name: 'Hall A', displayOrder: 0 }])
  mocked.iframes.list.mockResolvedValue([])
  mocked.connections.list.mockResolvedValue([])
  mocked.connections.live.mockResolvedValue({})
  mocked.bulk.applyDevices.mockResolvedValue({
    ok: true,
    dryRun: false,
    created: 0,
    updated: 0,
    errors: [],
    rows: [],
  })
})

/** Mount the sheet with the driver selected and its stores hydrated. */
async function mountSheet(): Promise<VueWrapper> {
  const wrapper = mount(DeviceSheet, { attachTo: document.body })
  await flush()
  await wrapper.find('#sheet-driver').setValue('samsung-mdc')
  await flush()
  return wrapper
}

/** Let the store fetches and the watchers settle. */
async function flush(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const headers = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('thead th').map((th) => th.text().replace('*', '').trim())

const cellTexts = (wrapper: VueWrapper, rowIndex: number): string[] =>
  wrapper
    .findAll('tbody tr')
    [rowIndex]!.findAll('td')
    .map((td) => td.text())

describe('DeviceSheet', () => {
  it('renders one row per physical box: connection and device columns together', async () => {
    const wrapper = await mountSheet()

    // Both halves of a 1:1 device are columns of the same row.
    expect(headers(wrapper)).toEqual(
      expect.arrayContaining(['Name', 'Host / IP', 'Display ID', 'Type', 'Room', 'Enabled']),
    )
    expect(wrapper.text()).toContain('One row = one device')
  })

  it('keeps a column the manifest already defaults out of the way until asked for', async () => {
    const wrapper = await mountSheet()

    // Port defaults to 1515 for this driver, so it isn't worth 64 rows of width…
    expect(headers(wrapper)).not.toContain('Port')

    const sheet = wrapper.vm as unknown as { showAdvanced: boolean }
    sheet.showAdvanced = true
    await flush()

    // …but it's a real column, one toggle away.
    expect(headers(wrapper)).toContain('Port')
  })

  it('continues the series when rows are added, instead of copying', async () => {
    const wrapper = await mountSheet()

    // Seed the first row through the grid itself.
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add rows'))!
      .trigger('click')
    await flush()
    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    sheet.rows[0]!.values.name = 'Displej 01'
    sheet.rows[0]!.values['connection.host'] = '10.0.1.1'
    await flush()

    // Ask for three more.
    await wrapper.find('input[aria-label="Rows to add"]').setValue('3')
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add rows'))!
      .trigger('click')
    await flush()

    expect(sheet.rows).toHaveLength(4)
    expect(sheet.rows.map((row) => row.values.name)).toEqual([
      'Displej 01',
      'Displej 02',
      'Displej 03',
      'Displej 04',
    ])
    expect(sheet.rows.map((row) => row.values['connection.host'])).toEqual([
      '10.0.1.1',
      '10.0.1.2',
      '10.0.1.3',
      '10.0.1.4',
    ])
    // And it's on screen, not just in state.
    expect(cellTexts(wrapper, 3).join(' ')).toContain('Displej 04')
  })

  it('fills a pasted block from the cursor, growing the sheet to fit', async () => {
    const wrapper = await mountSheet()
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add rows'))!
      .trigger('click')
    await flush()

    // Put the cursor on the first cell, then paste two rows × two columns.
    await wrapper.findAll('tbody td.cell')[0]!.trigger('mousedown')
    await wrapper.find('.sheet').trigger('paste', {
      clipboardData: {
        getData: () => 'Wall 1\t10.0.2.1\nWall 2\t10.0.2.2',
      },
    })
    await flush()

    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.rows.map((row) => row.values.name)).toEqual(['Wall 1', 'Wall 2'])
    expect(sheet.rows.map((row) => row.values['connection.host'])).toEqual(['10.0.2.1', '10.0.2.2'])
  })

  it('assigns a room to every checked row in one action', async () => {
    const wrapper = await mountSheet()
    await wrapper.find('input[aria-label="Rows to add"]').setValue('3')
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add rows'))!
      .trigger('click')
    await flush()

    await wrapper.find('thead input[type="checkbox"]').setValue(true)
    await flush()
    await wrapper.find('select[aria-label="Assign room to selected rows"]').setValue('r1')
    await flush()

    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    expect(sheet.rows.every((row) => row.values.roomId === 'r1')).toBe(true)
  })

  it('sends every changed row as one batch, with the connection nested in it', async () => {
    const wrapper = await mountSheet()
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add rows'))!
      .trigger('click')
    await flush()
    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    sheet.rows[0]!.values.name = 'Displej 01'
    sheet.rows[0]!.values['connection.host'] = '10.0.1.1'
    sheet.rows[0]!.values.type = 'display'
    await flush()

    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Save'))!
      .trigger('click')
    await flush()

    expect(mocked.bulk.applyDevices).toHaveBeenCalledTimes(1)
    const [payload] = mocked.bulk.applyDevices.mock.calls[0] as [
      { rows: Record<string, unknown>[]; dryRun: boolean },
    ]
    expect(payload.dryRun).toBe(false)
    expect(payload.rows).toHaveLength(1)
    expect(payload.rows[0]).toMatchObject({
      name: 'Displej 01',
      subtype: 'samsung-mdc.display',
      connection: { driverId: 'samsung-mdc', host: '10.0.1.1', name: 'Displej 01' },
    })
  })

  it('paints the cells a rejected batch names, and reports that nothing was written', async () => {
    mocked.bulk.applyDevices.mockResolvedValue({
      ok: false,
      dryRun: false,
      created: 0,
      updated: 0,
      rows: [],
      errors: [{ row: 0, field: 'connection.host', message: 'must match format "host"' }],
    })

    const wrapper = await mountSheet()
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add rows'))!
      .trigger('click')
    await flush()
    const sheet = wrapper.vm as unknown as { rows: { values: Record<string, unknown> }[] }
    sheet.rows[0]!.values.name = 'Displej 01'
    sheet.rows[0]!.values['connection.host'] = '10.0.1.999'
    await flush()

    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Save'))!
      .trigger('click')
    await flush()

    expect(wrapper.text()).toContain('nothing was written')
    // The Host cell — not the whole row — carries the mark.
    const invalid = wrapper.findAll('tbody td.invalid')
    expect(invalid.length).toBeGreaterThan(0)
    expect(invalid[0]!.attributes('title')).toContain('host')
  })
})

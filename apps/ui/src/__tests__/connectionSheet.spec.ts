/**
 * ConnectionSheet tests — the sheet that carries the job this whole editor
 * exists for: many connections, each little more than a name and an address.
 *
 * The point of most of these is what the sheet *doesn't* ask for: no driver
 * filter to see the table, no endpoint decided first, no config columns for
 * anything the manifest can default.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DriverManifest } from '@gallery/driver-core'
import ConnectionSheet from '@/components/admin/bulk/ConnectionSheet.vue'
import { buildConnectionColumns, buildConnectionPayload } from '@/lib/connectionSheet'
import type { SheetRow } from '@/lib/bulkSheet'
import { api } from '@/lib/api'

const netio: DriverManifest = {
  id: 'netio',
  name: 'NETIO',
  version: '0.1.0',
  vendor: 'NETIO',
  connectionSchema: {
    type: 'object',
    required: ['host'],
    properties: {
      host: { type: 'string', title: 'Host / IP' },
      port: { type: 'integer', title: 'Port', default: 80 },
      pollMs: { type: 'integer', title: 'Poll interval (ms)', default: 1000 },
    },
  },
  capabilities: { discovery: false, subscriptions: false, bidirectional: true },
  endpointTypes: [],
}

const iiyama: DriverManifest = {
  ...netio,
  id: 'iiyama-prolite',
  name: 'Iiyama ProLite Display',
  connectionSchema: {
    type: 'object',
    required: ['host', 'macAddress'],
    properties: {
      host: { type: 'string', title: 'Host / IP' },
      macAddress: { type: 'string', title: 'MAC address', description: 'For Wake-on-LAN.' },
      wolPort: { type: 'integer', title: 'Wake-on-LAN port', default: 9 },
    },
  },
}

describe('connection columns', () => {
  it('shows the driver as a column, not as a prerequisite', () => {
    const columns = buildConnectionColumns([netio, iiyama])

    expect(columns.map((column) => column.key).slice(0, 4)).toEqual([
      'name',
      'driverId',
      'host',
      'port',
    ])
    expect(columns.find((column) => column.key === 'driverId')?.options).toEqual([
      { value: 'netio', label: 'NETIO' },
      { value: 'iiyama-prolite', label: 'Iiyama ProLite Display' },
    ])
  })

  it('carries config a driver *requires*, and nothing it can default', () => {
    const keys = buildConnectionColumns([netio, iiyama]).map((column) => column.key)

    // Iiyama can't be woken without it, so it earns a column…
    expect(keys).toContain('config.macAddress')
    // …while everything with a manifest default stays out of the sheet.
    expect(keys).not.toContain('config.pollMs')
    expect(keys).not.toContain('config.wolPort')
  })

  it('says which driver needs a config column, since it applies to some rows only', () => {
    const columns = buildConnectionColumns([netio, iiyama])

    expect(columns.find((column) => column.key === 'config.macAddress')?.description).toContain(
      'Required by Iiyama ProLite Display',
    )
  })
})

describe('connection payload', () => {
  const columns = buildConnectionColumns([netio, iiyama])

  it('sends a new row flat, with config nested but no endpoint anywhere', () => {
    const row: SheetRow = {
      key: 'new:0',
      values: {
        name: 'Hall 1 — Netio 2',
        driverId: 'netio',
        host: '10.0.2.1',
        port: null,
        'config.macAddress': null,
        enabled: true,
      },
    }

    expect(buildConnectionPayload([row], columns)[0]).toEqual({
      connectionId: undefined,
      name: 'Hall 1 — Netio 2',
      driverId: 'netio',
      host: '10.0.2.1',
      port: null,
      config: {},
      enabled: true,
    })
  })

  it('omits the driver on an update — it is fixed at creation', () => {
    const row: SheetRow = {
      key: 'c1',
      connectionId: 'c1',
      values: { name: 'Renamed', driverId: 'netio', host: '10.0.2.9', port: 8080, enabled: false },
    }

    expect(buildConnectionPayload([row], columns)[0]).toMatchObject({
      connectionId: 'c1',
      driverId: undefined,
      host: '10.0.2.9',
      port: 8080,
      enabled: false,
    })
  })

  it('passes required config through when the row filled it in', () => {
    const row: SheetRow = {
      key: 'new:0',
      values: {
        name: 'Foyer display',
        driverId: 'iiyama-prolite',
        host: '10.0.5.1',
        'config.macAddress': 'AA:BB:CC:DD:EE:FF',
        enabled: true,
      },
    }

    expect(buildConnectionPayload([row], columns)[0]!.config).toEqual({
      macAddress: 'AA:BB:CC:DD:EE:FF',
    })
  })
})

// ── mounted behaviour ───────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  api: {
    drivers: { list: vi.fn<() => Promise<unknown>>() },
    connections: { list: vi.fn<() => Promise<unknown>>(), live: vi.fn<() => Promise<unknown>>() },
    bulk: {
      applyConnections: vi.fn<() => Promise<unknown>>(),
      deleteConnections: vi.fn<() => Promise<unknown>>(),
    },
  },
}))
vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>(), warning: vi.fn<() => void>() },
}))

const mocked = api as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

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
  mocked.drivers!.list!.mockResolvedValue([netio, iiyama])
  mocked.connections!.list!.mockResolvedValue([
    {
      id: 'c1',
      name: 'Hall 1 — Netio 1',
      driverId: 'netio',
      host: '10.0.2.1',
      port: 80,
      config: {},
      enabled: true,
    },
    {
      id: 'c2',
      name: 'Foyer display',
      driverId: 'iiyama-prolite',
      host: '10.0.5.1',
      config: { macAddress: 'AA:BB:CC:DD:EE:FF' },
      enabled: true,
    },
  ])
  mocked.connections!.live!.mockResolvedValue({})
  mocked.bulk!.applyConnections!.mockResolvedValue({
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

describe('ConnectionSheet', () => {
  it('lists every connection immediately, whatever driver it runs', async () => {
    const wrapper: VueWrapper = mount(ConnectionSheet, { attachTo: document.body })
    await flush()

    const body = wrapper.find('tbody').text()
    expect(body).toContain('Hall 1 — Netio 1')
    expect(body).toContain('Foyer display')
    // Two drivers, one table, no filter in sight.
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })

  it('posts the rows it changed, and only those', async () => {
    const wrapper: VueWrapper = mount(ConnectionSheet, { attachTo: document.body })
    await flush()

    // Rows are sorted by name, so find the one to edit rather than assuming.
    const sheet = wrapper.vm as unknown as {
      rows: { connectionId?: string; values: Record<string, unknown> }[]
    }
    sheet.rows.find((row) => row.connectionId === 'c1')!.values.host = '10.0.2.99'
    await flush()
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Save'))!
      .trigger('click')
    await flush()

    const [payload] = mocked.bulk!.applyConnections!.mock.calls[0] as [
      { rows: Record<string, unknown>[] },
    ]
    expect(payload.rows).toHaveLength(1)
    expect(payload.rows[0]).toMatchObject({ connectionId: 'c1', host: '10.0.2.99' })
  })
})

describe('deleting rows', () => {
  it('keeps the other unsaved rows when some of them are deleted', async () => {
    const wrapper: VueWrapper = mount(ConnectionSheet, { attachTo: document.body })
    await flush()

    // Add ten rows, then delete two of them: the other eight must survive.
    // (They didn't: the delete path re-read the store, which knows nothing
    // about rows that were never saved.)
    await wrapper.find('input[aria-label="Rows to add"]').setValue('10')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('continuing the series'))!
      .trigger('click')
    await flush()

    const sheet = wrapper.vm as unknown as {
      rows: { key: string; connectionId?: string }[]
      askDelete: (keys: string[]) => void
      confirmDelete: () => Promise<void>
    }
    const added = sheet.rows.filter((row) => !row.connectionId)
    expect(added).toHaveLength(10)

    sheet.askDelete([added[2]!.key, added[5]!.key])
    await sheet.confirmDelete()
    await flush()

    expect(sheet.rows.filter((row) => !row.connectionId)).toHaveLength(8)
    // The saved connections are untouched, and nothing was sent to the server.
    expect(sheet.rows.filter((row) => row.connectionId)).toHaveLength(2)
    expect(mocked.bulk!.deleteConnections!).not.toHaveBeenCalled()
  })
})

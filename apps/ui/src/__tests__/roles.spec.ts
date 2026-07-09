import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRolesStore } from '@/stores/roles'
import { makeRole } from './fixtures'

vi.mock('@/lib/api', () => ({
  api: { roles: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { api } from '@/lib/api'

describe('useRolesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads roles sorted by name and exposes byId', async () => {
    vi.mocked(api.roles.list).mockResolvedValue([
      makeRole({ id: 'b', name: 'Custodian' }),
      makeRole({ id: 'a', name: 'Admin', isAdmin: true }),
    ])
    const store = useRolesStore()
    await store.fetchAll()
    expect(store.records.map((r) => r.id)).toEqual(['a', 'b'])
    expect(store.byId('b')?.name).toBe('Custodian')
  })

  it('create inserts the returned role, keeping the list sorted', async () => {
    vi.mocked(api.roles.list).mockResolvedValue([makeRole({ id: 'a', name: 'Admin' })])
    const store = useRolesStore()
    await store.fetchAll()

    vi.mocked(api.roles.create).mockResolvedValue(makeRole({ id: 'z', name: 'Barista', deviceIds: ['d1'] }))
    const created = await store.create({ name: 'Barista', deviceIds: ['d1'] })
    expect(created?.id).toBe('z')
    expect(store.records.map((r) => r.name)).toEqual(['Admin', 'Barista'])
  })

  it('update replaces the record in place', async () => {
    vi.mocked(api.roles.list).mockResolvedValue([makeRole({ id: 'a', name: 'Custodian', deviceIds: [] })])
    const store = useRolesStore()
    await store.fetchAll()

    vi.mocked(api.roles.update).mockResolvedValue(makeRole({ id: 'a', name: 'Custodian', deviceIds: ['d1', 'd2'] }))
    await store.update('a', { deviceIds: ['d1', 'd2'] })
    expect(store.byId('a')?.deviceIds).toEqual(['d1', 'd2'])
  })

  it('remove drops the record on success', async () => {
    vi.mocked(api.roles.list).mockResolvedValue([makeRole({ id: 'a' })])
    const store = useRolesStore()
    await store.fetchAll()

    vi.mocked(api.roles.remove).mockResolvedValue(null)
    const ok = await store.remove('a')
    expect(ok).toBe(true)
    expect(store.records).toEqual([])
  })

  it('remove returns false and keeps the record when the API rejects (e.g. still in use)', async () => {
    vi.mocked(api.roles.list).mockResolvedValue([makeRole({ id: 'a' })])
    const store = useRolesStore()
    await store.fetchAll()

    vi.mocked(api.roles.remove).mockRejectedValue(new Error('role has users; reassign them first'))
    const ok = await store.remove('a')
    expect(ok).toBe(false)
    expect(store.records).toHaveLength(1)
  })
})

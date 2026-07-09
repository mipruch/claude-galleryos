import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUsersStore } from '@/stores/users'
import { makeUser } from './fixtures'

vi.mock('@/lib/api', () => ({
  api: { users: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { api } from '@/lib/api'

describe('useUsersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads users sorted by username and exposes byId', async () => {
    vi.mocked(api.users.list).mockResolvedValue([
      makeUser({ id: 'b', username: 'zed' }),
      makeUser({ id: 'a', username: 'anna' }),
    ])
    const store = useUsersStore()
    await store.fetchAll()
    expect(store.records.map((u) => u.id)).toEqual(['a', 'b'])
    expect(store.byId('b')?.username).toBe('zed')
  })

  it('never carries a passwordHash field on any record', async () => {
    vi.mocked(api.users.list).mockResolvedValue([makeUser({ id: 'a' })])
    const store = useUsersStore()
    await store.fetchAll()
    expect(store.records[0]).not.toHaveProperty('passwordHash')
  })

  it('create inserts the returned user', async () => {
    vi.mocked(api.users.list).mockResolvedValue([])
    const store = useUsersStore()
    await store.fetchAll()

    vi.mocked(api.users.create).mockResolvedValue(makeUser({ id: 'a', username: 'newbie' }))
    const created = await store.create({ username: 'newbie', password: 'secret123', roleId: 'role' })
    expect(created?.username).toBe('newbie')
    expect(store.records).toHaveLength(1)
  })

  it('update replaces the record in place', async () => {
    vi.mocked(api.users.list).mockResolvedValue([makeUser({ id: 'a', enabled: true })])
    const store = useUsersStore()
    await store.fetchAll()

    vi.mocked(api.users.update).mockResolvedValue(makeUser({ id: 'a', enabled: false }))
    await store.update('a', { enabled: false })
    expect(store.byId('a')?.enabled).toBe(false)
  })

  it('remove drops the record on success', async () => {
    vi.mocked(api.users.list).mockResolvedValue([makeUser({ id: 'a' })])
    const store = useUsersStore()
    await store.fetchAll()

    vi.mocked(api.users.remove).mockResolvedValue(null)
    const ok = await store.remove('a')
    expect(ok).toBe(true)
    expect(store.records).toEqual([])
  })
})

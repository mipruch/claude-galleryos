import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

// Mock the REST client so the store test never hits the network.
vi.mock('@/lib/api', () => ({
  api: {
    auth: { login: vi.fn() },
  },
}))

import { api } from '@/lib/api'

const STORAGE_KEY = 'galleryos-auth'

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('starts logged out', () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.isAdmin).toBe(false)
  })

  it('login stores the user/role and derives isAdmin from the role', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({
      user: { id: 'u1', username: 'admin', displayName: 'Administrator' },
      role: { id: 'r1', name: 'Admin', isAdmin: true },
    })
    const auth = useAuthStore()
    const ok = await auth.login('admin', 'secret123')
    expect(ok).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(auth.user?.username).toBe('admin')
  })

  it('login failure sets error and stays logged out', async () => {
    vi.mocked(api.auth.login).mockRejectedValue(new Error('invalid username or password'))
    const auth = useAuthStore()
    const ok = await auth.login('admin', 'wrong')
    expect(ok).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toBe('invalid username or password')
  })

  it('restores a previous login from sessionStorage via init()', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({
      user: { id: 'u1', username: 'custodian', displayName: null },
      role: { id: 'r2', name: 'Custodian', isAdmin: false },
    })
    const auth = useAuthStore()
    await auth.login('custodian', 'secret123')

    // Simulate a page reload: fresh Pinia + fresh store, same sessionStorage.
    setActivePinia(createPinia())
    const restored = useAuthStore()
    expect(restored.isAuthenticated).toBe(false) // not restored until init() runs
    restored.init()
    expect(restored.isAuthenticated).toBe(true)
    expect(restored.user?.username).toBe('custodian')
    expect(restored.role?.name).toBe('Custodian')
  })

  it('logout clears the user/role and sessionStorage', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({
      user: { id: 'u1', username: 'admin', displayName: null },
      role: { id: 'r1', name: 'Admin', isAdmin: true },
    })
    const auth = useAuthStore()
    await auth.login('admin', 'secret123')
    auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

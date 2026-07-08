/**
 * Auth store — a front-end-only login gate (see PLAN.md "Priority 6").
 *
 * There is no server-side session: the backend checks the password once and
 * returns the user + role, and this store just remembers that locally to
 * decide what to render (which admin sections are reachable, which devices
 * show up). Persisted to sessionStorage so a page refresh doesn't force a
 * re-login, but closing the tab does.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'

interface AuthUser {
  id: string
  username: string
  displayName: string | null
}

interface AuthRole {
  id: string
  name: string
  isAdmin: boolean
  deviceIds: string[]
}

const STORAGE_KEY = 'galleryos-auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const role = ref<AuthRole | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => role.value?.isAdmin ?? false)

  function persist(): void {
    try {
      if (user.value && role.value) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ user: user.value, role: role.value }))
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // ignore storage failures (private mode, quota) — the in-memory login still applies
    }
  }

  /** Restore a previous login from sessionStorage (call once at startup). */
  function init(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { user: AuthUser; role: AuthRole }
      user.value = parsed.user
      role.value = parsed.role
    } catch {
      // ignore storage/parse failures — just stay logged out
    }
  }

  async function login(username: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const result = await api.auth.login({ username, password })
      if (!result) return false
      user.value = result.user
      role.value = result.role
      persist()
      return true
    } catch (err) {
      error.value = errMsg(err)
      return false
    } finally {
      loading.value = false
    }
  }

  function logout(): void {
    user.value = null
    role.value = null
    persist()
  }

  return { user, role, loading, error, isAuthenticated, isAdmin, login, logout, init }
})

/**
 * Users store — admin-managed staff accounts. No self-registration; the
 * admin sets the initial password and can change it later from here.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { UserCreateInput, UserDTO, UserUpdateInput } from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

const sortByUsername = (rows: UserDTO[]): UserDTO[] =>
  [...rows].sort((a, b) => a.username.localeCompare(b.username))

export const useUsersStore = defineStore('users', () => {
  const records = ref<UserDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const users = computed(() => records.value)

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = sortByUsername((await api.users.list()) ?? [])
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load users', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  function replaceRecord(record: UserDTO): void {
    const i = records.value.findIndex((u) => u.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    records.value = sortByUsername(records.value)
  }

  const byId = (id: string): UserDTO | undefined => records.value.find((u) => u.id === id)

  async function create(input: UserCreateInput): Promise<UserDTO | null> {
    try {
      const created = await api.users.create(input)
      if (created) replaceRecord(created)
      toast.success('User created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create user', { description: errMsg(err) })
      return null
    }
  }

  async function update(id: string, input: UserUpdateInput): Promise<UserDTO | null> {
    try {
      const updated = await api.users.update(id, input)
      if (updated) replaceRecord(updated)
      return updated ?? null
    } catch (err) {
      toast.error('Could not save user', { description: errMsg(err) })
      return null
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await api.users.remove(id)
      records.value = records.value.filter((u) => u.id !== id)
      toast.success('User deleted')
      return true
    } catch (err) {
      toast.error('Could not delete user', { description: errMsg(err) })
      return false
    }
  }

  return { records, users, loading, loaded, error, fetchAll, byId, create, update, remove }
})

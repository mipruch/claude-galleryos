/**
 * Roles store — admin-managed permission sets. `deviceIds` is the n:n
 * `role_devices` join, edited as a full replacement set on every save (an
 * empty set means the role sees no devices; `isAdmin` roles see everything
 * regardless of `deviceIds`).
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { RoleCreateInput, RoleDTO, RoleUpdateInput } from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

const sortByName = (rows: RoleDTO[]): RoleDTO[] => [...rows].sort((a, b) => a.name.localeCompare(b.name))

export const useRolesStore = defineStore('roles', () => {
  const records = ref<RoleDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const roles = computed(() => records.value)

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = sortByName((await api.roles.list()) ?? [])
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load roles', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  function replaceRecord(record: RoleDTO): void {
    const i = records.value.findIndex((r) => r.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    records.value = sortByName(records.value)
  }

  const byId = (id: string): RoleDTO | undefined => records.value.find((r) => r.id === id)

  async function create(input: RoleCreateInput): Promise<RoleDTO | null> {
    try {
      const created = await api.roles.create(input)
      if (created) replaceRecord(created)
      toast.success('Role created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create role', { description: errMsg(err) })
      return null
    }
  }

  async function update(id: string, input: RoleUpdateInput): Promise<RoleDTO | null> {
    try {
      const updated = await api.roles.update(id, input)
      if (updated) replaceRecord(updated)
      return updated ?? null
    } catch (err) {
      toast.error('Could not save role', { description: errMsg(err) })
      return null
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await api.roles.remove(id)
      records.value = records.value.filter((r) => r.id !== id)
      toast.success('Role deleted')
      return true
    } catch (err) {
      toast.error('Could not delete role', { description: errMsg(err) })
      return false
    }
  }

  return { records, roles, loading, loaded, error, fetchAll, byId, create, update, remove }
})

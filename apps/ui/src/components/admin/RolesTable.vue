<script setup lang="ts">
/**
 * Roles tab of the admin Users & Roles page — list, create, edit, delete.
 * Split out of UsersView.vue (which was flagged high-complexity combining
 * both tabs in one template) so each tab owns just its own table + dialogs.
 */
import { onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { RoleDTO } from '@gallery/types'
import { useRolesStore } from '@/stores/roles'
import { useDevicesStore } from '@/stores/devices'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import RoleFormDialog from './RoleFormDialog.vue'

const roles = useRolesStore()
const devices = useDevicesStore()

onMounted(() => {
  roles.fetchAll()
  devices.init() // needed for the device checklist in the role form
})

const formOpen = ref(false)
const editing = ref<RoleDTO | null>(null)
const toDelete = ref<RoleDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(r: RoleDTO): void {
  editing.value = r
  formOpen.value = true
}
function askDelete(r: RoleDTO): void {
  toDelete.value = r
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const r = toDelete.value
  deleteOpen.value = false
  if (r) await roles.remove(r.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ roles.records.length }} role(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New role
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead class="w-40">Access</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in roles.records" :key="r.id">
            <TableCell class="font-medium">{{ r.name }}</TableCell>
            <TableCell class="text-muted-foreground">{{ r.description || '—' }}</TableCell>
            <TableCell>
              <Badge v-if="r.isAdmin" variant="default">Admin (all)</Badge>
              <Badge v-else variant="secondary">{{ r.deviceIds.length }} device(s)</Badge>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(r)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(r)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!roles.records.length">
            <TableCell colspan="4" class="text-muted-foreground py-10 text-center">No roles yet.</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <RoleFormDialog v-model:open="formOpen" :role="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Blocked while any user still holds this role — reassign them first. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive hover:bg-destructive/90" @click="confirmDelete">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

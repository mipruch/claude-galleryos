<script setup lang="ts">
/**
 * Users tab of the admin Users & Roles page — list, create, edit, delete.
 * Split out of UsersView.vue (which was flagged high-complexity combining
 * both tabs in one template) so each tab owns just its own table + dialogs.
 */
import { onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from '@lucide/vue'
import type { UserDTO } from '@gallery/types'
import { useUsersStore } from '@/stores/users'
import { useRolesStore } from '@/stores/roles'
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
import UserFormDialog from './UserFormDialog.vue'

const users = useUsersStore()
const roles = useRolesStore()

onMounted(() => {
  users.fetchAll()
  roles.fetchAll() // needed for the role-name lookup and the role picker in the form
})

const roleName = (roleId: string): string => roles.byId(roleId)?.name ?? '—'

const formOpen = ref(false)
const editing = ref<UserDTO | null>(null)
const toDelete = ref<UserDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(u: UserDTO): void {
  editing.value = u
  formOpen.value = true
}
function askDelete(u: UserDTO): void {
  toDelete.value = u
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const u = toDelete.value
  deleteOpen.value = false
  if (u) await users.remove(u.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ users.records.length }} user(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New user
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead>Display name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead class="w-24">Status</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="u in users.records" :key="u.id">
            <TableCell class="font-medium">{{ u.username }}</TableCell>
            <TableCell class="text-muted-foreground">{{ u.displayName || '—' }}</TableCell>
            <TableCell>{{ roleName(u.roleId) }}</TableCell>
            <TableCell>
              <Badge :variant="u.enabled ? 'default' : 'secondary'">
                {{ u.enabled ? 'Enabled' : 'Disabled' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(u)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(u)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!users.records.length">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              <UsersIcon class="mx-auto mb-2 size-6 opacity-50" />
              No users yet.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <UserFormDialog v-model:open="formOpen" :user="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.username }}”?</AlertDialogTitle>
          <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
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

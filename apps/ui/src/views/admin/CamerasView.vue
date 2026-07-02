<script setup lang="ts">
/**
 * Admin cameras list — every camera feed reference (name, description, icon,
 * URL, credentials) with create / edit / delete. No control, no position.
 * Reuses `useCamerasStore`.
 */
import { computed, onMounted, ref } from 'vue'
import { CameraIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { CameraDTO } from '@gallery/types'
import { useCamerasStore } from '@/stores/cameras'
import { Button } from '@/components/ui/button'
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
import CameraFormDialog from '@/components/admin/CameraFormDialog.vue'

const store = useCamerasStore()

onMounted(() => store.fetchAll())

const rows = computed(() => store.records)

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<CameraDTO | null>(null)
const toDelete = ref<CameraDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(c: CameraDTO): void {
  editing.value = c
  formOpen.value = true
}
function askDelete(c: CameraDTO): void {
  toDelete.value = c
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const c = toDelete.value
  deleteOpen.value = false
  if (c) await store.remove(c.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ rows.length }} camera(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New camera
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Username</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in rows" :key="c.id">
            <TableCell class="font-medium">{{ c.name }}</TableCell>
            <TableCell class="text-muted-foreground max-w-xs truncate">{{ c.description || '—' }}</TableCell>
            <TableCell class="text-muted-foreground max-w-md truncate">{{ c.url }}</TableCell>
            <TableCell class="text-muted-foreground">{{ c.username || '—' }}</TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(c)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(c)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!rows.length">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              <CameraIcon class="mx-auto mb-2 size-6 opacity-50" />
              No cameras yet. Add one to store a feed reference.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <CameraFormDialog v-model:open="formOpen" :camera="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This removes the camera reference.</AlertDialogDescription>
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

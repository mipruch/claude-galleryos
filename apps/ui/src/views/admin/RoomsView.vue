<script setup lang="ts">
/**
 * Admin rooms list — every room in display order with a device count, reorder
 * (up/down), edit and delete. Reuses `useRoomsStore` (CRUD + ordering) and
 * `useDevicesStore` for per-room device counts.
 */
import { computed, onMounted, ref } from 'vue'
import { ArrowDownIcon, ArrowUpIcon, DoorOpenIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { RoomDTO } from '@gallery/types'
import { useRoomsStore } from '@/stores/rooms'
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
import RoomFormDialog from '@/components/admin/RoomFormDialog.vue'

const store = useRoomsStore()
const devices = useDevicesStore()

onMounted(() => {
  store.fetchAll()
  devices.init()
})

const rows = computed(() => store.ordered)
const deviceCount = (roomId: string) => devices.records.filter((d) => d.roomId === roomId).length

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<RoomDTO | null>(null)
const toDelete = ref<RoomDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(r: RoomDTO): void {
  editing.value = r
  formOpen.value = true
}
function askDelete(r: RoomDTO): void {
  toDelete.value = r
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const r = toDelete.value
  deleteOpen.value = false
  if (r) await store.remove(r.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ rows.length }} room(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New room
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-20">Order</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead class="w-24 text-right">Devices</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(r, i) in rows" :key="r.id">
            <TableCell>
              <div class="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Move up" :disabled="i === 0" @click="store.move(r.id, -1)">
                  <ArrowUpIcon class="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move down"
                  :disabled="i === rows.length - 1"
                  @click="store.move(r.id, 1)"
                >
                  <ArrowDownIcon class="size-4" />
                </Button>
              </div>
            </TableCell>
            <TableCell class="font-medium">
              <span class="flex items-center gap-2">
                <span
                  class="size-3 shrink-0 rounded-full border"
                  :style="{ backgroundColor: r.color ?? 'transparent' }"
                />
                {{ r.name }}
              </span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ r.description || '—' }}</TableCell>
            <TableCell class="text-right">
              <Badge variant="secondary">{{ deviceCount(r.id) }}</Badge>
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

          <TableRow v-if="!rows.length">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              <DoorOpenIcon class="mx-auto mb-2 size-6 opacity-50" />
              No rooms yet. Create one to group devices and scenes.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <RoomFormDialog v-model:open="formOpen" :room="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Devices and scenes in this room become unassigned (they aren't deleted). This can't be undone.
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

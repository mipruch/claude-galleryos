<script setup lang="ts">
/**
 * Admin iframes list — every embedded device UI (user-panel sidebar entry)
 * with its URL and display order, plus create / edit / delete. Reuses
 * `useIframesStore`.
 */
import { computed, onMounted, ref } from 'vue'
import { AppWindowIcon, ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { IframeDTO } from '@gallery/types'
import { useIframesStore } from '@/stores/iframes'
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
import IframeFormDialog from '@/components/admin/IframeFormDialog.vue'

const store = useIframesStore()

onMounted(() => store.fetchAll())

const rows = computed(() => store.records)

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<IframeDTO | null>(null)
const toDelete = ref<IframeDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(f: IframeDTO): void {
  editing.value = f
  formOpen.value = true
}
function askDelete(f: IframeDTO): void {
  toDelete.value = f
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const f = toDelete.value
  deleteOpen.value = false
  if (f) await store.remove(f.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ rows.length }} iframe(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New iframe
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-20">Order</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(f, i) in rows" :key="f.id">
            <TableCell>
              <div class="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Move up" :disabled="i === 0" @click="store.move(f.id, -1)">
                  <ArrowUpIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Move down" :disabled="i === rows.length - 1" @click="store.move(f.id, 1)">
                  <ArrowDownIcon class="size-4" />
                </Button>
              </div>
            </TableCell>
            <TableCell class="font-medium">{{ f.name }}</TableCell>
            <TableCell class="text-muted-foreground max-w-md truncate">
              <a :href="f.url" target="_blank" rel="noopener noreferrer" class="hover:text-foreground hover:underline">
                {{ f.url }}
              </a>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(f)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(f)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!rows.length">
            <TableCell colspan="4" class="text-muted-foreground py-10 text-center">
              <AppWindowIcon class="mx-auto mb-2 size-6 opacity-50" />
              No iframes yet. Add one to embed an external device UI.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <IframeFormDialog v-model:open="formOpen" :iframe="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This removes the embedded UI and its sidebar entry.</AlertDialogDescription>
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

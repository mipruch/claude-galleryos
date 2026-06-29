<script setup lang="ts">
/**
 * Admin Layouts list — every wall-screen / tablet kiosk with its canvas size,
 * grid, and tile count, plus create / edit / delete and links to the builder
 * (`/admin/layouts/:id`) and the live chromeless viewer (`/kiosk/:name`).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ExternalLinkIcon,
  LayoutTemplateIcon,
  PencilIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
} from '@lucide/vue'
import type { KioskDTO } from '@gallery/types'
import { useKiosksStore } from '@/stores/kiosks'
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
import KioskFormDialog from '@/components/admin/KioskFormDialog.vue'

const store = useKiosksStore()
const router = useRouter()

onMounted(() => store.fetchAll())

const rows = computed(() => store.records)

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<KioskDTO | null>(null)
const toDelete = ref<KioskDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(k: KioskDTO): void {
  editing.value = k
  formOpen.value = true
}
function askDelete(k: KioskDTO): void {
  toDelete.value = k
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const k = toDelete.value
  deleteOpen.value = false
  if (k) await store.remove(k.id)
  toDelete.value = null
}

// After creating a new layout, jump straight into its builder. Edits stay put.
function onSaved(kiosk: KioskDTO): void {
  if (!editing.value) router.push(`/admin/layouts/${kiosk.id}`)
}

const viewerHref = (k: KioskDTO): string => `/kiosk/${encodeURIComponent(k.name)}`
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ rows.length }} layout(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New layout
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead class="w-32">Canvas</TableHead>
            <TableHead class="w-24">Grid</TableHead>
            <TableHead class="w-20">Tiles</TableHead>
            <TableHead class="w-44 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="k in rows" :key="k.id">
            <TableCell class="font-medium">{{ k.name }}</TableCell>
            <TableCell class="text-muted-foreground tabular-nums">{{ k.width }}×{{ k.height }}</TableCell>
            <TableCell class="text-muted-foreground tabular-nums">{{ k.config.columns }} col</TableCell>
            <TableCell class="text-muted-foreground tabular-nums">{{ k.config.tiles.length }}</TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Open builder" title="Open builder" @click="router.push(`/admin/layouts/${k.id}`)">
                  <SquarePenIcon class="size-4" />
                </Button>
                <a :href="viewerHref(k)" target="_blank" rel="noopener noreferrer" title="Open viewer">
                  <Button variant="ghost" size="icon-sm" aria-label="Open viewer">
                    <ExternalLinkIcon class="size-4" />
                  </Button>
                </a>
                <Button variant="ghost" size="icon-sm" aria-label="Edit" title="Edit" @click="openEdit(k)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" title="Delete" @click="askDelete(k)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!rows.length">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              <LayoutTemplateIcon class="mx-auto mb-2 size-6 opacity-50" />
              No layouts yet. Create one to design a wall screen or tablet.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <KioskFormDialog v-model:open="formOpen" :kiosk="editing" @saved="onSaved" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This removes the kiosk layout and its tiles.</AlertDialogDescription>
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

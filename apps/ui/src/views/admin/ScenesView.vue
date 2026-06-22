<script setup lang="ts">
/**
 * Admin scenes list — every scene with its room, tags and favourite flag, plus
 * run, edit and delete. Reuses `useScenesStore` (now with CRUD + favourite) and
 * `useDevicesStore` for room names. The editor (`SceneFormDialog`) loads a
 * scene's full actions on open.
 */
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlayIcon, PlusIcon, SparklesIcon, StarIcon, Trash2Icon } from '@lucide/vue'
import type { SceneDTO } from '@gallery/types'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import SceneFormDialog from '@/components/admin/SceneFormDialog.vue'

const store = useScenesStore()
const devices = useDevicesStore()

onMounted(() => {
  store.fetchAll()
  devices.init()
})

const ALL = '__all__'
const roomFilter = ref(ALL)

const roomName = (id: string | null) => (id ? (devices.rooms.find((r) => r.id === id)?.name ?? '—') : '—')

const rows = computed(() =>
  [...store.records]
    .filter((s) => (roomFilter.value !== ALL ? s.roomId === roomFilter.value : true))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<SceneDTO | null>(null)
const toDelete = ref<SceneDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(s: SceneDTO): void {
  editing.value = s
  formOpen.value = true
}
function askDelete(s: SceneDTO): void {
  toDelete.value = s
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const s = toDelete.value
  deleteOpen.value = false
  if (s) await store.remove(s.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Select v-model="roomFilter">
        <SelectTrigger class="w-44"><SelectValue placeholder="All rooms" /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="ALL">All rooms</SelectItem>
            <SelectItem v-for="r in devices.rooms" :key="r.id" :value="r.id">{{ r.name }}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New scene
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-10" />
            <TableHead>Name</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead class="w-44 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in rows" :key="s.id">
            <TableCell>
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="s.isFavorite ? 'Unfavourite' : 'Favourite'"
                @click="store.setFavorite(s.id, !s.isFavorite)"
              >
                <StarIcon class="size-4" :class="s.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'" />
              </Button>
            </TableCell>
            <TableCell class="font-medium">
              {{ s.name }}
              <span v-if="s.description" class="text-muted-foreground block text-xs">{{ s.description }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ roomName(s.roomId) }}</TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge v-for="t in s.tags ?? []" :key="t" variant="secondary">{{ t }}</Badge>
              </div>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Run"
                  :disabled="store.isRunning(s.id)"
                  @click="store.execute(s.id)"
                >
                  <PlayIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(s)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(s)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!rows.length">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              <SparklesIcon class="mx-auto mb-2 size-6 opacity-50" />
              No scenes match. Create one to orchestrate devices with a single tap.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <SceneFormDialog v-model:open="formOpen" :scene="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the scene and its actions. Schedules pointing at it will fail until repointed.
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

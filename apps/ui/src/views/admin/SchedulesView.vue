<script setup lang="ts">
/**
 * Admin schedules list — every CRON job with its scene, expression, timezone
 * and soonest upcoming run, plus enable/disable, edit and delete. Reuses
 * `useSchedulesStore` (now with CRUD) and `useScenesStore` for scene names.
 */
import { onMounted, ref } from 'vue'
import { CalendarClockIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { ScheduledJobDTO } from '@gallery/types'
import { useSchedulesStore } from '@/stores/schedules'
import { useScenesStore } from '@/stores/scenes'
import { formatDateTime, formatRelative, nextRunOf } from '@/lib/schedules'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import ScheduleFormDialog from '@/components/admin/ScheduleFormDialog.vue'

const store = useSchedulesStore()
const scenes = useScenesStore()

onMounted(() => {
  store.fetchAll()
  scenes.fetchAll()
})

const sceneName = (id: string) => scenes.records.find((s) => s.id === id)?.name ?? id
const nowMs = Date.now()
const nextRun = (s: ScheduledJobDTO) => nextRunOf(s, store.previewsFor(s.id))

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<ScheduledJobDTO | null>(null)
const toDelete = ref<ScheduledJobDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(s: ScheduledJobDTO): void {
  editing.value = s
  formOpen.value = true
}
function askDelete(s: ScheduledJobDTO): void {
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
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ store.records.length }} schedule(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New schedule
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Scene</TableHead>
            <TableHead>CRON</TableHead>
            <TableHead>Timezone</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead class="w-24">Enabled</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in store.records" :key="s.id">
            <TableCell class="font-medium">{{ s.name }}</TableCell>
            <TableCell>
              <Badge variant="secondary">{{ sceneName(s.sceneId) }}</Badge>
            </TableCell>
            <TableCell class="font-mono text-xs">{{ s.cron }}</TableCell>
            <TableCell class="text-muted-foreground">{{ s.timezone }}</TableCell>
            <TableCell class="text-muted-foreground">
              <template v-if="s.enabled && nextRun(s)">
                <span :title="formatDateTime(nextRun(s))">{{ formatRelative(nextRun(s), nowMs) }}</span>
              </template>
              <span v-else>—</span>
            </TableCell>
            <TableCell>
              <Switch :model-value="s.enabled" @update:model-value="store.toggle(s.id, $event)" />
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(s)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(s)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!store.records.length">
            <TableCell colspan="7" class="text-muted-foreground py-10 text-center">
              <CalendarClockIcon class="mx-auto mb-2 size-6 opacity-50" />
              No schedules yet. Create one to run a scene on a timer.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <ScheduleFormDialog v-model:open="formOpen" :schedule="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This unregisters the timer and removes the schedule.</AlertDialogDescription>
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

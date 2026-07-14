<script setup lang="ts">
/**
 * Admin schedules list — every CRON job with its expression, timezone and
 * soonest upcoming run, plus enable/disable and delete. Creating and wiring a
 * schedule's trigger actions both happen on the workflow canvas now (the old
 * ScheduleFormDialog is gone); "New" and "Edit" here just navigate there, the
 * latter with the row pre-selected.
 */
import { onMounted, ref } from 'vue'
import { CalendarClockIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { ScheduledJobDTO } from '@gallery/types'
import { useRouter } from 'vue-router'
import { useSchedulesStore } from '@/stores/schedules'
import { formatDateTime, formatRelative, nextRunOf } from '@/lib/schedules'
import { Button } from '@/components/ui/button'
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

const router = useRouter()
const store = useSchedulesStore()

onMounted(() => {
  store.fetchAll()
})

const nowMs = Date.now()
const nextRun = (s: ScheduledJobDTO) => nextRunOf(s, store.previewsFor(s.id))

function openOnCanvas(s?: ScheduledJobDTO): void {
  router.push({ name: 'admin-workflows', query: s ? { select: `schedule:${s.id}` } : {} })
}

// ── delete state ────────────────────────────────────────────────────────────
const toDelete = ref<ScheduledJobDTO | null>(null)
const deleteOpen = ref(false)

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
      <Button @click="openOnCanvas()">
        <PlusIcon class="size-4" />
        New schedule
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
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
                <Button variant="ghost" size="icon-sm" aria-label="Edit on canvas" @click="openOnCanvas(s)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(s)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!store.records.length">
            <TableCell colspan="6" class="text-muted-foreground py-10 text-center">
              <CalendarClockIcon class="mx-auto mb-2 size-6 opacity-50" />
              No schedules yet. Create one on the workflow canvas to run a scene or device action on a timer.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This unregisters the timer and removes the schedule and any trigger actions wired to it.</AlertDialogDescription>
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

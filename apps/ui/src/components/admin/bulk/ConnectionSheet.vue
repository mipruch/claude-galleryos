<script setup lang="ts">
/**
 * Connection sheet — every connection in one table, no filtering required.
 *
 * This is the answer to the question the device sheet couldn't reach: "what if
 * I want to add twenty different NETIOs?" A connection is a socket with a name
 * and an address; nothing about it needs a driver picked in advance or an
 * endpoint decided first, so the grid opens with everything in it and the
 * driver is simply a column.
 *
 * Everything interactive lives in `SheetGrid`; this component only maps
 * connections to rows and back, and owns the save.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { CheckIcon, RotateCcwIcon, SaveIcon, TriangleAlertIcon } from '@lucide/vue'
import type { BulkConnectionApplyResult } from '@gallery/types'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import { cloneRow, dirtyRows, type SheetRow } from '@/lib/bulkSheet'
import {
  buildConnectionColumns,
  buildConnectionPayload,
  rowFromConnection,
} from '@/lib/connectionSheet'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { Button } from '@/components/ui/button'
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
import SheetGrid from './SheetGrid.vue'

const connections = useConnectionsStore()
const drivers = useDriversStore()

const columns = computed(() => buildConnectionColumns(drivers.manifests))
const rows = ref<SheetRow[]>([])
const originals = ref(new Map<string, SheetRow>())
const serverErrors = ref(new Map<string, string>())
const saving = ref(false)
const pendingDelete = ref<string[]>([])
const deleteOpen = ref(false)

const changed = computed(() => dirtyRows(rows.value, originals.value))
const dirtyKeys = computed(() => new Set(changed.value.map((row) => row.key)))

function hydrate(): void {
  serverErrors.value = new Map()
  rows.value = [...connections.connections]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((connection) => rowFromConnection(connection, columns.value))
  originals.value = new Map(rows.value.map((row) => [row.key, cloneRow(row)]))
}

watch(columns, hydrate)
watch(
  () => connections.connections.length,
  () => {
    // Never clobber unsaved edits when the socket refreshes the store.
    if (!changed.value.length) hydrate()
  },
)

/** Map a rejected batch back onto cells — `errors[].row` indexes what we sent. */
function markErrors(result: BulkConnectionApplyResult, sent: SheetRow[]): void {
  const marks = new Map<string, string>()
  for (const error of result.errors) {
    const row = sent[error.row]
    const index = row ? rows.value.findIndex((candidate) => candidate.key === row.key) : -1
    if (index < 0) continue
    marks.set(`${index}:${error.field ?? 'name'}`, error.message)
  }
  serverErrors.value = marks
}

async function submit(dryRun: boolean): Promise<void> {
  const sent = changed.value
  if (!sent.length || saving.value) return
  saving.value = true
  try {
    const result = await api.bulk.applyConnections({
      rows: buildConnectionPayload(sent, columns.value),
      dryRun,
    })
    if (!result) return
    if (!result.ok) {
      markErrors(result, sent)
      toast.error(`${result.errors.length} problem(s) — nothing was saved`, {
        description: result.errors[0]?.message,
      })
      return
    }
    serverErrors.value = new Map()
    if (dryRun) {
      toast.success(`Looks good: ${result.created} to create, ${result.updated} to update`)
      return
    }
    toast.success(`Saved — ${result.created} created, ${result.updated} updated`)
    await connections.fetchAll()
    hydrate()
  } catch (err) {
    toast.error('Could not save', { description: errMsg(err) })
  } finally {
    saving.value = false
  }
}

function askDelete(keys: string[]): void {
  if (!keys.length) return
  pendingDelete.value = keys
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  deleteOpen.value = false
  const keys = new Set(pendingDelete.value)
  const saved = rows.value.filter((row) => keys.has(row.key) && row.connectionId)
  rows.value = rows.value.filter((row) => !(keys.has(row.key) && !row.connectionId))

  if (saved.length) {
    try {
      const result = await api.bulk.deleteConnections({
        connectionIds: saved.map((row) => row.connectionId as string),
      })
      if (!result?.ok) {
        toast.error('Nothing was deleted', {
          description: result?.errors.map((error) => error.message).join('; ') ?? 'Unknown error',
        })
        return
      }
      toast.success(`Deleted ${result.deletedConnections} connection(s)`)
      await connections.fetchAll()
    } catch (err) {
      toast.error('Could not delete connections', { description: errMsg(err) })
      return
    }
  }
  hydrate()
}

onMounted(async () => {
  await Promise.all([drivers.load(), connections.init()])
  hydrate()
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <SheetGrid
      :columns="columns"
      :rows="rows"
      :dirty-keys="dirtyKeys"
      :cell-errors="serverErrors"
      :busy="saving"
      empty-label="No connections yet — add a row, or paste names and addresses from your spreadsheet."
      @update:rows="rows = $event"
      @delete="askDelete"
    />

    <div class="flex flex-wrap items-center gap-2">
      <p class="text-muted-foreground text-sm">
        <template v-if="changed.length">
          {{ changed.length }} row(s) changed · nothing is written until you save
        </template>
        <template v-else>No changes</template>
      </p>
      <p v-if="serverErrors.size" class="text-destructive flex items-center gap-1.5 text-sm">
        <TriangleAlertIcon class="size-4" />
        {{ serverErrors.size }} cell(s) rejected — nothing was written.
      </p>
      <div class="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="!changed.length || saving"
          @click="submit(true)"
        >
          <CheckIcon class="size-4" />
          Check
        </Button>
        <Button variant="outline" size="sm" :disabled="!changed.length || saving" @click="hydrate">
          <RotateCcwIcon class="size-4" />
          Discard
        </Button>
        <Button size="sm" :disabled="!changed.length || saving" @click="submit(false)">
          <SaveIcon class="size-4" />
          Save {{ changed.length || '' }}
        </Button>
      </div>
    </div>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ pendingDelete.length }} connection(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops their drivers. A connection that still has devices on it is refused — delete
            those first.
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

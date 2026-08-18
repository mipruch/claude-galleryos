<script setup lang="ts">
/**
 * Device sheet — the endpoint side of bulk editing, on the shared `SheetGrid`.
 *
 * It opens with every device already in it: name, connection, type, room,
 * enabled. Nothing has to be chosen to see the table, and those columns are
 * editable for any device regardless of driver — which covers most of what
 * bulk editing devices is actually for.
 *
 * Choosing a driver (and, where the driver offers several, an endpoint type)
 * *scopes* the sheet: the rows narrow to that kind of endpoint and the columns
 * grow to include its addressing. That is the mode worth having for something
 * like a BSS DSP, where a rack of matrix crosspoints differs only by a few
 * numbers per row — and it's the only mode in which new rows can be added,
 * since an endpoint can't be created without knowing how it is addressed.
 *
 * For a 1:1 driver (`soloEndpointType` — a display on its own IP) the scoped
 * sheet also carries the connection's own columns, so one row still means one
 * physical box. Connections that aren't 1:1 are created in the Connections
 * sheet instead, which needs no scoping at all.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { CheckIcon, RotateCcwIcon, SaveIcon, TriangleAlertIcon } from '@lucide/vue'
import type { BulkApplyResult } from '@gallery/types'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import {
  buildBulkPayload,
  buildColumns,
  cloneRow,
  dirtyRows,
  resolveEndpointType,
  rowFromDevice,
  sheetModeOf,
  type SheetRow,
} from '@/lib/bulkSheet'
import { useConnectionsStore } from '@/stores/connections'
import { useDevicesStore } from '@/stores/devices'
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

const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()

// ── scope (optional: an empty driver means "every device") ──────────────────
const driverId = ref('')
const endpointTypeName = ref('')
const manifest = computed(() => drivers.get(driverId.value))
const mode = computed(() => sheetModeOf(manifest.value))
const endpointType = computed(() => resolveEndpointType(manifest.value, endpointTypeName.value))
const endpointChoices = computed(() =>
  manifest.value && !manifest.value.soloEndpointType && manifest.value.endpointTypes.length > 1
    ? manifest.value.endpointTypes
    : [],
)
/** New endpoints need addressing, which only a scoped sheet knows. */
const scoped = computed(() => !!manifest.value && !!endpointType.value)

const connectionOptions = computed(() =>
  connections.connections
    .filter((connection) => !driverId.value || connection.driverId === driverId.value)
    .map((connection) => ({ value: connection.id, label: connection.name })),
)

const columns = computed(() =>
  buildColumns(
    manifest.value,
    endpointType.value,
    devices.rooms,
    mode.value,
    // A 1:1 row *is* its connection, so it needs no picker.
    mode.value === 'unit' && scoped.value ? [] : connectionOptions.value,
  ),
)

// ── rows ────────────────────────────────────────────────────────────────────
const rows = ref<SheetRow[]>([])
const originals = ref(new Map<string, SheetRow>())
const serverErrors = ref(new Map<string, string>())
const saving = ref(false)
const pendingDelete = ref<string[]>([])
const deleteOpen = ref(false)

const changed = computed(() => dirtyRows(rows.value, originals.value))
const dirtyKeys = computed(() => new Set(changed.value.map((row) => row.key)))

/**
 * Rebuild the sheet from the store.
 *
 * `keepUnsaved` decides what happens to rows the operator has added but not
 * saved: Discard and a successful save drop them (they either aren't wanted or
 * have come back from the server), while a delete keeps them — deleting two of
 * ten freshly added rows must leave eight, not none.
 */
function hydrate(keepUnsaved = false): void {
  const unsaved = keepUnsaved ? rows.value.filter((row) => !originals.value.has(row.key)) : []
  serverErrors.value = new Map()
  const byId = new Map(connections.connections.map((connection) => [connection.id, connection]))
  const mine = devices.records
    .filter((device) => {
      if (!driverId.value) return true
      const connection = byId.get(device.connectionId)
      if (connection?.driverId !== driverId.value) return false
      return !endpointType.value || device.subtype === endpointType.value.type
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  rows.value = mine.map((device) =>
    rowFromDevice(device, byId.get(device.connectionId), columns.value),
  )
  originals.value = new Map(rows.value.map((row) => [row.key, cloneRow(row)]))
  if (unsaved.length) rows.value = [...rows.value, ...unsaved]
}

watch(driverId, () => {
  endpointTypeName.value = ''
})
watch([columns], hydrate)
watch(
  () => devices.records.length + connections.connections.length,
  () => {
    if (!changed.value.length) hydrate()
  },
)

/** Map a rejected batch back onto cells — `errors[].row` indexes what we sent. */
function markErrors(result: BulkApplyResult, sent: SheetRow[]): void {
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
    const result = await api.bulk.applyDevices({
      rows: buildBulkPayload(sent, columns.value, {
        mode: mode.value,
        driverId: driverId.value,
        endpointType: endpointType.value?.type,
      }),
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
    await Promise.all([devices.fetchAll(), connections.fetchAll()])
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
  const saved = rows.value.filter((row) => keys.has(row.key) && row.deviceId)
  rows.value = rows.value.filter((row) => !(keys.has(row.key) && !row.deviceId))

  if (saved.length) {
    try {
      const result = await api.bulk.deleteDevices({
        deviceIds: saved.map((row) => row.deviceId as string),
        // A 1:1 row is one box: its connection goes with it rather than being
        // left stranded for someone to puzzle over later.
        deleteOrphanedConnections: mode.value === 'unit' && scoped.value,
      })
      if (!result?.ok) {
        toast.error('Nothing was deleted', {
          description: result?.errors.map((error) => error.message).join('; ') ?? 'Unknown error',
        })
        return
      }
      toast.success(`Deleted ${result.deletedDevices} device(s)`)
      await Promise.all([devices.fetchAll(), connections.fetchAll()])
    } catch (err) {
      toast.error('Could not delete devices', { description: errMsg(err) })
      return
    }
    hydrate(true)
  }
}

onMounted(async () => {
  await Promise.all([drivers.load(), devices.init(), connections.init()])
  hydrate()
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Scope: optional, and only needed to add endpoints or edit addressing. -->
    <div class="flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <label class="text-muted-foreground text-xs font-medium" for="sheet-driver">Driver</label>
        <select
          id="sheet-driver"
          v-model="driverId"
          class="border-input bg-background h-9 w-56 rounded-md border px-2 text-sm"
        >
          <option value="">All devices</option>
          <option v-for="driver in drivers.manifests" :key="driver.id" :value="driver.id">
            {{ driver.name }}
          </option>
        </select>
      </div>

      <div v-if="endpointChoices.length" class="space-y-1">
        <label class="text-muted-foreground text-xs font-medium" for="sheet-endpoint">
          Endpoint type
        </label>
        <select
          id="sheet-endpoint"
          v-model="endpointTypeName"
          class="border-input bg-background h-9 w-64 rounded-md border px-2 text-sm"
        >
          <option value="">Select an endpoint type…</option>
          <option v-for="choice in endpointChoices" :key="choice.type" :value="choice.type">
            {{ choice.name }}
          </option>
        </select>
      </div>

      <p class="text-muted-foreground pb-2 text-sm">
        <template v-if="scoped && mode === 'unit'">
          One row = one device, and its connection is written with it.
        </template>
        <template v-else-if="scoped">Rows are endpoints; pick each one's connection.</template>
        <template v-else>
          Every device. Pick a driver to edit addressing or add new endpoints.
        </template>
      </p>
    </div>

    <SheetGrid
      :columns="columns"
      :rows="rows"
      :dirty-keys="dirtyKeys"
      :cell-errors="serverErrors"
      :busy="saving"
      empty-label="No devices here yet — pick a driver above, then add a row."
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
          <AlertDialogTitle>Delete {{ pendingDelete.length }} device(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            Saved devices are removed immediately.
            <template v-if="mode === 'unit' && scoped">
              Each device's connection goes with it once nothing else uses it.
            </template>
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

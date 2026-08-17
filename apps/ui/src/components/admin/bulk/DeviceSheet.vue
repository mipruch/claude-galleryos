<script setup lang="ts">
/**
 * Bulk device sheet — a spreadsheet over the device list, for the jobs the
 * single-record dialog is wrong for: standing up 64 identical displays, or
 * retyping one field across a whole room.
 *
 * The grid behaves the way an operator coming from Google Sheets or DataGrip
 * expects: click a cell, type; arrow keys and Tab move; Shift extends a
 * rectangular selection; ⌘/Ctrl+C and ⌘/Ctrl+V exchange TSV with the outside
 * world (so a column of names and IPs can be pasted straight out of the
 * customer's spreadsheet); ⌘/Ctrl+D fills a selection down, continuing a
 * series rather than just copying — "Displej 01" and 10.0.1.1 become
 * "Displej 02" and 10.0.1.2. "Add rows" does the same thing without a
 * clipboard: fill one row, ask for 63 more, and the counter and the address
 * walk forward while the settled columns (type, room, port) carry down.
 *
 * A row is one *physical box*, not one database record. For a driver that
 * declares `soloEndpointType` (a Samsung display on its own IP, a projector)
 * the connection and the endpoint are written together from one row, so
 * nobody names 64 connections by hand — see `lib/bulkSheet.ts` for the two
 * sheet shapes. For gateway drivers the connection is picked once above the
 * grid and rows are endpoints on it.
 *
 * Nothing is written until Save, which sends every changed row in one
 * all-or-nothing request (`POST /bulk/devices`). A rejected batch comes back
 * addressed by row and field, so the offending cells turn red and nothing is
 * half-applied. The single-record dialog on the List tab is untouched and
 * remains the right tool for editing one device.
 *
 * The select/checkbox cells are native controls rather than the shadcn
 * components used elsewhere: inside a grid, keyboard behaviour and paste
 * targeting matter more than styling, and a popover-based select would fight
 * both.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  ArrowDownIcon,
  CheckIcon,
  Columns3Icon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from '@lucide/vue'
import type { BulkApplyResult } from '@gallery/types'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import {
  appendRows,
  buildBulkPayload,
  buildColumns,
  dirtyRows,
  extendSeries,
  formatCell,
  isInRange,
  parseCell,
  parseClipboardGrid,
  rangeBetween,
  resolveEndpointType,
  rowFromDevice,
  sheetModeOf,
  toClipboardGrid,
  validateCell,
  type CellRef,
  type SheetColumn,
  type SheetRow,
  type SheetValue,
} from '@/lib/bulkSheet'
import { useConnectionsStore } from '@/stores/connections'
import { useDevicesStore } from '@/stores/devices'
import { useDriversStore } from '@/stores/drivers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()

// ── what this sheet is editing ──────────────────────────────────────────────
const driverId = ref('')
const gatewayId = ref('')
/** Explicit endpoint type, for gateway drivers that offer several (BSS: fader / mute / meter). */
const endpointTypeName = ref('')
const manifest = computed(() => drivers.get(driverId.value))
const mode = computed(() => sheetModeOf(manifest.value))
const endpointType = computed(() => resolveEndpointType(manifest.value, endpointTypeName.value))
/** Shown only when the driver leaves the choice open. */
const endpointChoices = computed(() =>
  manifest.value && !manifest.value.soloEndpointType && manifest.value.endpointTypes.length > 1
    ? manifest.value.endpointTypes
    : [],
)
/** Gateways available to hang endpoint rows off, for non-1:1 drivers. */
const gateways = computed(() =>
  connections.connections.filter((c) => c.driverId === driverId.value),
)
const ready = computed(
  () => !!manifest.value && !!endpointType.value && (mode.value === 'unit' || !!gatewayId.value),
)

// Every column the sheet knows about; `columns` is what's on screen. Rows carry
// values for all of them so hiding a column never drops what it holds.
const allColumns = computed(() =>
  buildColumns(manifest.value, endpointType.value, devices.rooms, mode.value),
)
const showAdvanced = ref(false)
const columns = computed(() => allColumns.value.filter((c) => showAdvanced.value || !c.advanced))
const advancedCount = computed(() => allColumns.value.filter((c) => c.advanced).length)

// ── grid state ──────────────────────────────────────────────────────────────
const rows = ref<SheetRow[]>([])
const originals = ref(new Map<string, SheetRow>())
const selectedRowKeys = ref(new Set<string>())
const anchor = ref<CellRef | null>(null)
const cursor = ref<CellRef | null>(null)
const editing = ref(false)
const draft = ref('')
/** Server-reported problems, keyed `${rowIndex}:${columnKey}`. */
const serverErrors = ref(new Map<string, string>())
const saving = ref(false)
const addCount = ref(1)
const deleteOpen = ref(false)
const gridRef = ref<HTMLElement | null>(null)
// A `ref` inside a v-for collects an array; the editor is a single element that
// comes and goes, so it's captured by callback instead.
let editorEl: HTMLInputElement | null = null
const setEditorEl = (el: unknown): void => {
  editorEl = (el as HTMLInputElement | null) ?? null
}
let newRowSeq = 0

const selection = computed(() =>
  anchor.value && cursor.value ? rangeBetween(anchor.value, cursor.value) : null,
)
const changed = computed(() => dirtyRows(rows.value, originals.value))
const selectedRows = computed(() => rows.value.filter((row) => selectedRowKeys.value.has(row.key)))

const cloneRow = (row: SheetRow): SheetRow => ({ ...row, values: { ...row.values } })

/** Rebuild the grid from the store for the current driver / gateway. */
function hydrate(): void {
  serverErrors.value = new Map()
  selectedRowKeys.value = new Set()
  anchor.value = null
  cursor.value = null
  if (!driverId.value) {
    rows.value = []
    originals.value = new Map()
    return
  }
  const byId = new Map(connections.connections.map((c) => [c.id, c]))
  const mine = devices.records
    .filter((device) => {
      const connection = byId.get(device.connectionId)
      if (!connection || connection.driverId !== driverId.value) return false
      return mode.value === 'unit' || device.connectionId === gatewayId.value
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  rows.value = mine.map((device) =>
    rowFromDevice(device, byId.get(device.connectionId), allColumns.value),
  )
  originals.value = new Map(rows.value.map((row) => [row.key, cloneRow(row)]))
}

watch(driverId, () => {
  endpointTypeName.value = ''
  gatewayId.value = ''
})
watch([driverId, gatewayId, endpointTypeName], hydrate)
watch(
  () => devices.records.length + connections.connections.length,
  () => {
    // Don't clobber unsaved edits when a socket update refreshes the stores.
    if (!changed.value.length) hydrate()
  },
)

// Preselect the driver when there's only one sensible answer.
watch(
  () => drivers.manifests.length,
  () => {
    if (!driverId.value && drivers.manifests.length === 1) driverId.value = drivers.manifests[0]!.id
  },
)
watch(gateways, (list) => {
  if (mode.value === 'endpoint' && !gatewayId.value && list.length === 1)
    gatewayId.value = list[0]!.id
})

// ── cell helpers ────────────────────────────────────────────────────────────
const cellKey = (rowIndex: number, column: SheetColumn): string => `${rowIndex}:${column.key}`

function cellText(rowIndex: number, column: SheetColumn): string {
  const row = rows.value[rowIndex]
  return row ? formatCell(column, row.values[column.key] ?? null) : ''
}

function setCell(rowIndex: number, column: SheetColumn, value: SheetValue): void {
  const row = rows.value[rowIndex]
  if (!row) return
  row.values[column.key] = value
  serverErrors.value.delete(cellKey(rowIndex, column))
}

function cellError(rowIndex: number, column: SheetColumn): string | null {
  const server = serverErrors.value.get(cellKey(rowIndex, column))
  if (server) return server
  const row = rows.value[rowIndex]
  if (!row) return null
  return validateCell(column, row.values[column.key] ?? null)
}

const isRowDirty = (row: SheetRow): boolean => {
  if (!row.deviceId) return true
  const original = originals.value.get(row.key)
  return (
    !original || Object.keys(row.values).some((key) => row.values[key] !== original.values[key])
  )
}

// ── selection & keyboard ────────────────────────────────────────────────────
function focusCell(rowIndex: number, colIndex: number, extend = false): void {
  const target = {
    row: Math.max(0, Math.min(rowIndex, rows.value.length - 1)),
    col: Math.max(0, Math.min(colIndex, columns.value.length - 1)),
  }
  cursor.value = target
  if (!extend || !anchor.value) anchor.value = { ...target }
  editing.value = false
  void nextTick(() => gridRef.value?.focus())
}

function onCellMouseDown(rowIndex: number, colIndex: number, event: MouseEvent): void {
  focusCell(rowIndex, colIndex, event.shiftKey)
}

function startEditing(initial?: string): void {
  const cell = cursor.value
  if (!cell) return
  const column = columns.value[cell.col]
  if (!column || column.kind === 'boolean' || column.kind === 'select') return
  draft.value = initial ?? cellText(cell.row, column)
  editing.value = true
  void nextTick(() => {
    editorEl?.focus()
    if (initial === undefined) editorEl?.select()
  })
}

function commitEdit(move: 'down' | 'right' | 'none' = 'none'): void {
  // Enter commits and moves on, which unmounts the input and fires blur —
  // without this guard that second call would write the draft into the *next*
  // cell.
  if (!editing.value) return
  const cell = cursor.value
  const column = cell ? columns.value[cell.col] : undefined
  if (cell && column) setCell(cell.row, column, parseCell(column, draft.value))
  editing.value = false
  if (!cell) return
  if (move === 'down') focusCell(cell.row + 1, cell.col)
  else if (move === 'right') focusCell(cell.row, cell.col + 1)
  else void nextTick(() => gridRef.value?.focus())
}

function clearSelectedCells(): void {
  const range = selection.value
  if (!range) return
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      const column = columns.value[col]
      if (column) setCell(row, column, column.kind === 'boolean' ? false : null)
    }
  }
}

/**
 * Continue each selected column downwards from the top of the selection.
 *
 * One filled seed row steps by one ("Displej 01" → "Displej 02"); two filled
 * rows set the step, which is how a `10.0.1.1 / 10.0.1.3` pair fills every
 * other address. Non-text columns (type, room, enabled) copy the seed.
 */
function fillDown(): void {
  const range = selection.value
  if (!range || range.bottom === range.top) return
  for (let col = range.left; col <= range.right; col++) {
    const column = columns.value[col]
    if (!column) continue
    const secondSeeded = range.top + 1 <= range.bottom && cellText(range.top + 1, column) !== ''
    const seedRows = secondSeeded ? [range.top, range.top + 1] : [range.top]
    const firstTarget = range.top + seedRows.length
    if (firstTarget > range.bottom) continue

    if (column.kind === 'text' || column.kind === 'number') {
      const seeds = seedRows.map((row) => cellText(row, column))
      const filled = extendSeries(seeds, range.bottom - firstTarget + 1)
      filled.forEach((value, offset) =>
        setCell(firstTarget + offset, column, parseCell(column, value)),
      )
    } else {
      const seed = rows.value[range.top]?.values[column.key] ?? null
      for (let row = firstTarget; row <= range.bottom; row++) setCell(row, column, seed)
    }
  }
}

function onKeydown(event: KeyboardEvent): void {
  const cell = cursor.value
  if (!cell || editing.value) return
  const meta = event.metaKey || event.ctrlKey
  const column = columns.value[cell.col]

  if (meta && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    fillDown()
    return
  }
  // Copy/paste are handled by the clipboard events, which carry the payload.
  if (meta && ['c', 'v', 'x', 'a'].includes(event.key.toLowerCase())) return

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      focusCell(cell.row - 1, cell.col, event.shiftKey)
      return
    case 'ArrowDown':
      event.preventDefault()
      focusCell(cell.row + 1, cell.col, event.shiftKey)
      return
    case 'ArrowLeft':
      event.preventDefault()
      focusCell(cell.row, cell.col - 1, event.shiftKey)
      return
    case 'ArrowRight':
      event.preventDefault()
      focusCell(cell.row, cell.col + 1, event.shiftKey)
      return
    case 'Tab':
      event.preventDefault()
      focusCell(cell.row, cell.col + (event.shiftKey ? -1 : 1))
      return
    case 'Enter':
    case 'F2':
      event.preventDefault()
      if (column?.kind === 'boolean')
        setCell(cell.row, column, !rows.value[cell.row]?.values[column.key])
      else startEditing()
      return
    case ' ':
      if (column?.kind === 'boolean') {
        event.preventDefault()
        setCell(cell.row, column, !rows.value[cell.row]?.values[column.key])
      }
      return
    case 'Escape':
      anchor.value = { ...cell }
      return
    case 'Backspace':
    case 'Delete':
      event.preventDefault()
      clearSelectedCells()
      return
    default:
      break
  }

  // Any printable character starts an edit with that character, as in a sheet.
  if (!meta && !event.altKey && event.key.length === 1) {
    event.preventDefault()
    startEditing(event.key)
  }
}

function onCopy(event: ClipboardEvent): void {
  const range = selection.value
  if (!range || editing.value) return
  const grid: string[][] = []
  for (let row = range.top; row <= range.bottom; row++) {
    const line: string[] = []
    for (let col = range.left; col <= range.right; col++) {
      const column = columns.value[col]
      if (column) line.push(cellText(row, column))
    }
    grid.push(line)
  }
  event.clipboardData?.setData('text/plain', toClipboardGrid(grid))
  event.preventDefault()
}

/** Paste a TSV block from Sheets/Excel at the cursor, growing the sheet to fit. */
function onPaste(event: ClipboardEvent): void {
  const cell = cursor.value
  if (!cell || editing.value) return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text) return
  event.preventDefault()

  const grid = parseClipboardGrid(text)
  if (!grid.length) return
  const missing = cell.row + grid.length - rows.value.length
  if (missing > 0) addRows(missing)

  grid.forEach((line, rowOffset) => {
    line.forEach((value, colOffset) => {
      const column = columns.value[cell.col + colOffset]
      if (column) setCell(cell.row + rowOffset, column, parseCell(column, value))
    })
  })
  const width = Math.max(...grid.map((line) => line.length))
  anchor.value = { ...cell }
  cursor.value = {
    row: Math.min(cell.row + grid.length - 1, rows.value.length - 1),
    col: Math.min(cell.col + width - 1, columns.value.length - 1),
  }
}

// ── row operations ──────────────────────────────────────────────────────────
function addRows(count: number): void {
  const created = appendRows(rows.value, allColumns.value, count, newRowSeq)
  newRowSeq += count
  rows.value = [...rows.value, ...created]
  void nextTick(() => focusCell(rows.value.length - created.length, 0))
}

function toggleRowSelection(key: string, checked: boolean): void {
  const next = new Set(selectedRowKeys.value)
  if (checked) next.add(key)
  else next.delete(key)
  selectedRowKeys.value = next
}

function toggleAllRows(checked: boolean): void {
  selectedRowKeys.value = checked ? new Set(rows.value.map((row) => row.key)) : new Set()
}

/** Apply one value to a column across every selected row — the "assign a room to these six" action. */
function applyToSelection(columnKey: string, value: SheetValue): void {
  const column = allColumns.value.find((c) => c.key === columnKey)
  if (!column) return
  for (const row of selectedRows.value) {
    row.values[columnKey] = value
    const index = rows.value.indexOf(row)
    serverErrors.value.delete(cellKey(index, column))
  }
}

async function deleteSelectedRows(): Promise<void> {
  deleteOpen.value = false
  const saved = selectedRows.value.filter((row) => row.deviceId)
  const unsaved = selectedRows.value.filter((row) => !row.deviceId)
  rows.value = rows.value.filter((row) => !unsaved.includes(row))

  if (saved.length) {
    try {
      const result = await api.bulk.deleteDevices({
        deviceIds: saved.map((row) => row.deviceId as string),
        // A 1:1 row is one box: deleting the device should not leave its
        // connection behind for someone to find later and wonder about.
        deleteOrphanedConnections: mode.value === 'unit',
      })
      if (!result?.ok) {
        toast.error('Nothing was deleted', {
          description: result?.errors.map((e) => e.message).join('; ') ?? 'Unknown error',
        })
        return
      }
      toast.success(`Deleted ${result.deletedDevices} device(s)`)
      await Promise.all([devices.fetchAll(), connections.fetchAll()])
    } catch (err) {
      toast.error('Could not delete devices', { description: errMsg(err) })
      return
    }
  }
  selectedRowKeys.value = new Set()
  hydrate()
}

// ── saving ──────────────────────────────────────────────────────────────────
function payloadFor(dirty: SheetRow[]) {
  return buildBulkPayload(dirty, allColumns.value, {
    mode: mode.value,
    driverId: driverId.value,
    endpointType: endpointType.value?.type,
    connectionId: gatewayId.value || undefined,
  })
}

/** Map a rejected batch back onto cells: `errors[].row` indexes the rows we sent. */
function markErrors(result: BulkApplyResult, dirty: SheetRow[]): void {
  const marks = new Map<string, string>()
  for (const error of result.errors) {
    const row = dirty[error.row]
    const index = row ? rows.value.findIndex((r) => r.key === row.key) : -1
    if (index < 0) continue
    marks.set(`${index}:${error.field ?? 'name'}`, error.message)
  }
  serverErrors.value = marks
}

async function submit(dryRun: boolean): Promise<void> {
  const dirty = changed.value
  if (!dirty.length || saving.value) return
  saving.value = true
  try {
    const result = await api.bulk.applyDevices({ rows: payloadFor(dirty), dryRun })
    if (!result) return
    if (!result.ok) {
      markErrors(result, dirty)
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

function discard(): void {
  hydrate()
}

onMounted(() => {
  devices.init()
  connections.init()
  drivers.load()
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- What the sheet edits, and the row/column tools. -->
    <div class="flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <label class="text-muted-foreground text-xs font-medium" for="sheet-driver">Driver</label>
        <select
          id="sheet-driver"
          v-model="driverId"
          class="border-input bg-background h-9 w-56 rounded-md border px-2 text-sm"
        >
          <option value="">Select a driver…</option>
          <option v-for="d in drivers.manifests" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>

      <div v-if="manifest && mode === 'endpoint'" class="space-y-1">
        <label class="text-muted-foreground text-xs font-medium" for="sheet-gateway"
          >Connection</label
        >
        <select
          id="sheet-gateway"
          v-model="gatewayId"
          class="border-input bg-background h-9 w-56 rounded-md border px-2 text-sm"
        >
          <option value="">Select a connection…</option>
          <option v-for="c in gateways" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div v-if="endpointChoices.length" class="space-y-1">
        <label class="text-muted-foreground text-xs font-medium" for="sheet-endpoint"
          >Endpoint type</label
        >
        <select
          id="sheet-endpoint"
          v-model="endpointTypeName"
          class="border-input bg-background h-9 w-56 rounded-md border px-2 text-sm"
        >
          <option value="">Select an endpoint type…</option>
          <option v-for="e in endpointChoices" :key="e.type" :value="e.type">{{ e.name }}</option>
        </select>
      </div>

      <p v-if="manifest && mode === 'unit'" class="text-muted-foreground pb-2 text-sm">
        One row = one device <span class="opacity-60">(its connection is created with it)</span>
      </p>
      <p v-else-if="manifest && !gateways.length" class="text-muted-foreground pb-2 text-sm">
        No connection uses this driver yet — create one first.
      </p>

      <div class="ml-auto flex items-end gap-2">
        <Popover v-if="advancedCount">
          <PopoverTrigger as-child>
            <Button variant="outline" size="sm">
              <Columns3Icon class="size-4" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64">
            <label class="flex items-center gap-2 text-sm">
              <input v-model="showAdvanced" type="checkbox" class="size-4" />
              Show advanced columns ({{ advancedCount }})
            </label>
            <p class="text-muted-foreground mt-2 text-xs">
              Driver settings that already have a sensible default — timeouts, delimiters, the
              connection's own name.
            </p>
          </PopoverContent>
        </Popover>

        <div v-if="ready" class="flex items-end gap-1">
          <Input
            v-model.number="addCount"
            type="number"
            min="1"
            max="500"
            class="h-9 w-20"
            aria-label="Rows to add"
          />
          <Button variant="outline" size="sm" @click="addRows(Math.max(1, addCount))">
            <PlusIcon class="size-4" />
            Add rows
          </Button>
        </div>
      </div>
    </div>

    <!-- Row-level actions for the checkbox selection. -->
    <div
      v-if="selectedRows.length"
      class="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
    >
      <span class="text-sm font-medium">{{ selectedRows.length }} row(s) selected</span>
      <select
        class="border-input bg-background h-8 rounded-md border px-2 text-sm"
        aria-label="Assign room to selected rows"
        @change="applyToSelection('roomId', ($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">Assign room…</option>
        <option v-for="room in devices.rooms" :key="room.id" :value="room.id">
          {{ room.name }}
        </option>
      </select>
      <Button variant="outline" size="sm" @click="applyToSelection('enabled', true)">Enable</Button>
      <Button variant="outline" size="sm" @click="applyToSelection('enabled', false)"
        >Disable</Button
      >
      <Button variant="ghost" size="sm" class="text-destructive" @click="deleteOpen = true">
        <Trash2Icon class="size-4" />
        Delete
      </Button>
    </div>

    <!-- The grid. Focus lives on this container; cells are painted, not inputs. -->
    <div
      v-if="ready"
      ref="gridRef"
      class="sheet max-h-[65vh] overflow-auto rounded-md border outline-none"
      tabindex="0"
      @keydown="onKeydown"
      @copy="onCopy"
      @paste="onPaste"
    >
      <table class="w-full border-collapse text-sm">
        <thead class="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th class="w-10 border-b p-2">
              <input
                type="checkbox"
                class="size-4"
                aria-label="Select all rows"
                :checked="!!rows.length && selectedRowKeys.size === rows.length"
                @change="toggleAllRows(($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th class="text-muted-foreground w-10 border-b p-2 text-right text-xs font-normal">
              #
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              class="border-b border-l p-2 text-left font-medium"
              :title="column.description"
            >
              {{ column.label }}
              <span v-if="column.required" class="text-destructive">*</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIndex) in rows"
            :key="row.key"
            :class="{ 'bg-amber-50/60 dark:bg-amber-950/20': isRowDirty(row) }"
          >
            <td class="border-b p-2 text-center">
              <input
                type="checkbox"
                class="size-4"
                :aria-label="`Select row ${rowIndex + 1}`"
                :checked="selectedRowKeys.has(row.key)"
                @change="toggleRowSelection(row.key, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="text-muted-foreground border-b p-2 text-right text-xs tabular-nums">
              {{ rowIndex + 1 }}
            </td>
            <td
              v-for="(column, colIndex) in columns"
              :key="column.key"
              class="cell border-b border-l p-0"
              :class="{
                selected: selection && isInRange(selection, rowIndex, colIndex),
                cursor: cursor?.row === rowIndex && cursor?.col === colIndex,
                invalid: !!cellError(rowIndex, column),
              }"
              :title="cellError(rowIndex, column) ?? undefined"
              @mousedown="onCellMouseDown(rowIndex, colIndex, $event)"
              @dblclick="startEditing()"
            >
              <!-- The focused text cell becomes a real input; everything else is painted text. -->
              <input
                v-if="editing && cursor?.row === rowIndex && cursor?.col === colIndex"
                :ref="setEditorEl"
                v-model="draft"
                class="h-8 w-full bg-transparent px-2 outline-none"
                @keydown.enter.prevent="commitEdit('down')"
                @keydown.tab.prevent="commitEdit('right')"
                @keydown.esc.prevent="editing = false"
                @blur="commitEdit()"
              />
              <select
                v-else-if="column.kind === 'select'"
                class="h-8 w-full appearance-none bg-transparent px-2 outline-none"
                :value="String(row.values[column.key] ?? '')"
                @change="
                  setCell(rowIndex, column, ($event.target as HTMLSelectElement).value || null)
                "
              >
                <option value="">—</option>
                <option v-for="option in column.options" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <div
                v-else-if="column.kind === 'boolean'"
                class="flex h-8 items-center justify-center"
              >
                <input
                  type="checkbox"
                  class="size-4"
                  :checked="row.values[column.key] !== false"
                  @change="setCell(rowIndex, column, ($event.target as HTMLInputElement).checked)"
                />
              </div>
              <div v-else class="h-8 truncate px-2 leading-8">{{ cellText(rowIndex, column) }}</div>
            </td>
          </tr>

          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="text-muted-foreground p-10 text-center">
              Nothing here yet — “Add rows” to start, or paste a block from your spreadsheet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="text-muted-foreground rounded-md border p-10 text-center text-sm">
      Pick a driver to start a sheet.
    </p>

    <!-- Save bar. -->
    <div v-if="ready" class="flex flex-wrap items-center gap-2">
      <p class="text-muted-foreground text-sm">
        <template v-if="changed.length">
          {{ changed.length }} row(s) changed · nothing is written until you save
        </template>
        <template v-else>No changes</template>
      </p>
      <p class="text-muted-foreground ml-auto hidden text-xs lg:block">
        <ArrowDownIcon class="inline size-3" /> ⌘/Ctrl+D fills down · ⌘/Ctrl+C / ⌘/Ctrl+V exchange
        cells with your spreadsheet
      </p>
      <Button
        variant="outline"
        size="sm"
        :disabled="!changed.length || saving"
        @click="submit(true)"
      >
        <CheckIcon class="size-4" />
        Check
      </Button>
      <Button variant="outline" size="sm" :disabled="!changed.length || saving" @click="discard">
        <RotateCcwIcon class="size-4" />
        Discard
      </Button>
      <Button size="sm" :disabled="!changed.length || saving" @click="submit(false)">
        <SaveIcon class="size-4" />
        Save {{ changed.length || '' }}
      </Button>
    </div>

    <p v-if="serverErrors.size" class="text-destructive flex items-center gap-2 text-sm">
      <TriangleAlertIcon class="size-4" />
      {{ serverErrors.size }} cell(s) rejected by the server — nothing was written.
    </p>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ selectedRows.length }} row(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            Saved devices are removed immediately.
            <template v-if="mode === 'unit'">
              Each device's connection goes with it once nothing else uses it.
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive hover:bg-destructive/90"
            @click="deleteSelectedRows"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
.sheet {
  /* A grid is only usable if a cell's state is legible at a glance: the cursor
     reads as a single outlined cell, the range as a wash, an invalid cell as a
     red field that survives both. */
  .cell {
    position: relative;
    cursor: cell;
    user-select: none;

    &.selected {
      background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
    }

    &.cursor {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
      z-index: 1;
    }

    &.invalid {
      background-color: color-mix(in oklab, var(--color-destructive) 16%, transparent);
    }
  }
}
</style>

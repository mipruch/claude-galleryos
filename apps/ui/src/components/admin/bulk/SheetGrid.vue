<script setup lang="ts">
/**
 * The spreadsheet grid — one component, used by every bulk sheet (connections,
 * devices). It owns the interaction and nothing else: what the columns mean and
 * where the rows are saved is the caller's business.
 *
 * It behaves the way someone arriving from DataGrip, Notion or Google Sheets
 * expects, which is mostly a list of things *not* to get wrong:
 *
 *  - **One selection, not two.** Ticking a row's box and selecting its cells are
 *    the same act — the boxes mirror the cell selection, and a row action works
 *    on whatever is highlighted. There is no second, invisible selection that a
 *    delete could act on instead.
 *  - **Selection is a list of rectangles.** Drag to sweep, Shift to extend,
 *    ⌘/Ctrl-click or ⌘/Ctrl-drag to add a disjoint block, so rows 4, 6 and 7 is
 *    a thing you can say.
 *  - **Paste fills the selection.** Copy one cell, select thirty, paste: all
 *    thirty take it. A block bigger than a cell lays down from the cursor and
 *    grows the sheet to fit.
 *  - **⌘/Ctrl+Z undoes**, all the way back through edits, pastes, fills, sorts
 *    and added rows.
 *  - **⌘/Ctrl+D duplicates** the selected rows in place (each copy lands
 *    directly under its source and is a *new* record, not a second reference to
 *    the same one); fill-down moved to ⌘/Ctrl+↓. Right-clicking a row offers
 *    both, plus delete.
 *  - **Columns sort** from a control in their header, which reorders the rows
 *    array itself — every index-based behaviour keeps meaning what it says, and
 *    the sort is undoable like anything else.
 *  - **Columns never move.** The layout is fixed; the editor floats above its
 *    cell (Notion-style) instead of stretching the column while you type.
 *  - **Every column is visible**, and the grid scrolls sideways. Nothing is
 *    hidden behind a toggle.
 *  - **Categorical cells open the app's own picker**, and a choice applies to
 *    every selected cell in that column — that is the whole bulk-assign story,
 *    with no separate control anywhere else.
 *
 * Built on the vendored shadcn-vue `Table` primitives (plus `ContextMenu`,
 * `Popover` and `Switch`), so it looks like the rest of the admin rather than
 * like a widget. Deliberately *not* shadcn-vue's DataTable recipe: that is a
 * TanStack-backed read-and-filter table, and its row model fights range
 * selection and in-place editing, which are the whole point here. Sorting —
 * the one DataTable feature this needs — is a dozen lines below.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  PlusIcon,
  Trash2Icon,
} from '@lucide/vue'
import {
  appendRows,
  blankRow,
  cloneRow,
  extendSeries,
  formatCell,
  isSelected,
  parseCell,
  parseClipboardGrid,
  pastePlan,
  rangeBetween,
  selectedCells,
  selectedRowIndices,
  toClipboardGrid,
  validateCell,
  wholeRow,
  type CellRef,
  type Selection,
  type SheetColumn,
  type SheetRow,
  type SheetValue,
} from '@/lib/bulkSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const props = withDefaults(
  defineProps<{
    columns: SheetColumn[]
    rows: SheetRow[]
    /** Row keys that differ from what's saved — painted as pending. */
    dirtyKeys?: Set<string>
    /** Server-reported problems, keyed `${rowIndex}:${columnKey}`. */
    cellErrors?: Map<string, string>
    emptyLabel?: string
    /** Disables editing while a save is in flight. */
    busy?: boolean
  }>(),
  { emptyLabel: 'Nothing here yet — add a row, or paste a block from your spreadsheet.' },
)

const emit = defineEmits<{
  'update:rows': [SheetRow[]]
  /** Row keys the operator asked to delete; the caller decides what that means. */
  delete: [string[]]
}>()

/** Sticky lives on the header cells: Tailwind collapses table borders, and a
 * collapsed-border table only honours `position: sticky` on th/td. */
const STICKY_HEAD = 'bg-muted/60 sticky top-0 z-20'

/** Sensible fixed widths per column kind, when a column doesn't name its own. */
const WIDTH_BY_KIND: Record<SheetColumn['kind'], string> = {
  text: '14rem',
  number: '8rem',
  select: '11rem',
  boolean: '6rem',
}
const widthOf = (column: SheetColumn): string => column.width ?? WIDTH_BY_KIND[column.kind]

// ── selection ───────────────────────────────────────────────────────────────
const selection = ref<Selection>([])
const cursor = ref<CellRef | null>(null)
const anchor = ref<CellRef | null>(null)
const editing = ref(false)
const draft = ref('')
const pickerOpen = ref(false)
const gridRef = ref<HTMLElement | null>(null)
const addCount = ref(10)
let dragging = false
let editorEl: HTMLInputElement | null = null
const setEditorEl = (el: unknown): void => {
  editorEl = (el as HTMLInputElement | null) ?? null
}
let newRowSeq = 0

const selectedRows = computed(() => selectedRowIndices(selection.value))
const selectedRowKeys = computed(() =>
  selectedRows.value.map((index) => props.rows[index]?.key).filter((key): key is string => !!key),
)
const isRowSelected = (index: number): boolean =>
  selection.value.some((r) => index >= r.top && index <= r.bottom)
const activeColumn = computed(() => (cursor.value ? props.columns[cursor.value.col] : undefined))

defineExpose({ selectedRowKeys })

// ── undo / redo ─────────────────────────────────────────────────────────────
/** Snapshots of the whole row set. Simple, and correct for sheets this size. */
const undoStack = ref<SheetRow[][]>([])
const redoStack = ref<SheetRow[][]>([])
const HISTORY_LIMIT = 100

const snapshot = (): SheetRow[] => props.rows.map(cloneRow)

/** Apply a mutation to a copy of the rows, recording it for undo. */
function mutate(apply: (rows: SheetRow[]) => void): void {
  if (props.busy) return
  const before = snapshot()
  const next = snapshot()
  apply(next)
  undoStack.value.push(before)
  if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
  redoStack.value = []
  emit('update:rows', next)
}

function undo(): void {
  const previous = undoStack.value.pop()
  if (!previous) return
  redoStack.value.push(snapshot())
  emit('update:rows', previous)
}

function redo(): void {
  const next = redoStack.value.pop()
  if (!next) return
  undoStack.value.push(snapshot())
  emit('update:rows', next)
}

// Rebuilding the sheet (a different driver, a fresh fetch) starts a new history.
watch(
  () => props.columns,
  () => {
    undoStack.value = []
    redoStack.value = []
    selection.value = []
    cursor.value = null
    anchor.value = null
    editing.value = false
  },
)

// ── cells ───────────────────────────────────────────────────────────────────
const cellKey = (rowIndex: number, column: SheetColumn): string => `${rowIndex}:${column.key}`

function cellText(rowIndex: number, column: SheetColumn): string {
  const row = props.rows[rowIndex]
  return row ? formatCell(column, row.values[column.key] ?? null) : ''
}

function cellError(rowIndex: number, column: SheetColumn): string | null {
  const server = props.cellErrors?.get(cellKey(rowIndex, column))
  if (server) return server
  const row = props.rows[rowIndex]
  return row ? validateCell(column, row.values[column.key] ?? null, row.values) : null
}

/** Write one value into a set of cells, as a single undoable step. */
function setCells(targets: Array<{ row: number; col: number; value: SheetValue }>): void {
  if (!targets.length) return
  mutate((rows) => {
    for (const target of targets) {
      const column = props.columns[target.col]
      const row = rows[target.row]
      if (column && row) row.values[column.key] = target.value
    }
  })
}

/**
 * Cells in the selection that share a column with the active cell — what a
 * picker choice or a switch toggle spreads across.
 */
function siblingsOfActive(): Array<{ row: number; col: number }> {
  const cell = cursor.value
  if (!cell) return []
  const inSelection = selectedCells(selection.value).filter((c) => c.col === cell.col)
  return inSelection.length ? inSelection : [cell]
}

// ── pointer selection ───────────────────────────────────────────────────────
function focusGrid(): void {
  void nextTick(() => gridRef.value?.focus())
}

function onCellMouseDown(rowIndex: number, colIndex: number, event: MouseEvent): void {
  // Clicking inside the cell that is *already* being edited must not tear the
  // editor down — that's what made a second click "fall out" of typing mode.
  if (editing.value && cursor.value?.row === rowIndex && cursor.value?.col === colIndex) return
  event.preventDefault()
  editing.value = false
  const cell = { row: rowIndex, col: colIndex }
  const additive = event.metaKey || event.ctrlKey

  if (event.shiftKey && anchor.value) {
    selection.value = [...selection.value.slice(0, -1), rangeBetween(anchor.value, cell)]
  } else if (additive) {
    anchor.value = cell
    selection.value = [...selection.value, rangeBetween(cell, cell)]
  } else {
    anchor.value = cell
    selection.value = [rangeBetween(cell, cell)]
  }
  cursor.value = cell
  dragging = true
  focusGrid()
}

/** Sweep: extend the range being dragged as the pointer crosses cells. */
function onCellMouseEnter(rowIndex: number, colIndex: number): void {
  if (!dragging || !anchor.value) return
  cursor.value = { row: rowIndex, col: colIndex }
  selection.value = [...selection.value.slice(0, -1), rangeBetween(anchor.value, cursor.value)]
}

const stopDragging = (): void => {
  dragging = false
}

/**
 * Right-clicking outside the current selection moves it to the row under the
 * pointer first, so the menu always acts on what the operator is pointing at —
 * and right-clicking *inside* a selection leaves it alone, so "duplicate these
 * six" works.
 */
function onRowContextMenu(rowIndex: number): void {
  if (isRowSelected(rowIndex)) return
  selection.value = [wholeRow(rowIndex, props.columns.length)]
  anchor.value = { row: rowIndex, col: 0 }
  cursor.value = { row: rowIndex, col: 0 }
}

/** Ticking a row selects its cells — one selection, not two. */
function toggleRow(rowIndex: number, additive: boolean): void {
  const full = wholeRow(rowIndex, props.columns.length)
  if (isRowSelected(rowIndex)) {
    selection.value = selection.value.filter(
      (range) => !(rowIndex >= range.top && rowIndex <= range.bottom),
    )
    return
  }
  selection.value = additive ? [...selection.value, full] : [full]
  anchor.value = { row: rowIndex, col: 0 }
  cursor.value = { row: rowIndex, col: 0 }
}

/** The `#` header doubles as select-all / clear. */
function selectAllRows(): void {
  const all = props.rows.length > 0 && selectedRows.value.length === props.rows.length
  selection.value = all ? [] : props.rows.map((_, index) => wholeRow(index, props.columns.length))
}

/** Clicking a header selects the column — the fastest way to retype one field. */
function selectColumn(colIndex: number, additive: boolean): void {
  const range = {
    top: 0,
    bottom: Math.max(props.rows.length - 1, 0),
    left: colIndex,
    right: colIndex,
  }
  selection.value = additive ? [...selection.value, range] : [range]
  anchor.value = { row: 0, col: colIndex }
  cursor.value = { row: 0, col: colIndex }
  focusGrid()
}

// ── editing ─────────────────────────────────────────────────────────────────
function startEditing(initial?: string): void {
  const cell = cursor.value
  const column = activeColumn.value
  if (!cell || !column || props.busy) return
  if (column.kind === 'select') {
    pickerOpen.value = true
    return
  }
  if (column.kind === 'boolean') {
    toggleBoolean()
    return
  }
  draft.value = initial ?? cellText(cell.row, column)
  editing.value = true
  void nextTick(() => {
    editorEl?.focus()
    if (initial === undefined) editorEl?.select()
  })
}

function commitEdit(move: 'down' | 'right' | 'none' = 'none'): void {
  // Enter commits and moves on, which unmounts the input and fires blur;
  // without this guard the second call would write into the *next* cell.
  if (!editing.value) return
  const cell = cursor.value
  const column = activeColumn.value
  editing.value = false
  if (cell && column) setCells([{ ...cell, value: parseCell(column, draft.value) }])
  if (!cell) return
  if (move === 'down') moveCursor(cell.row + 1, cell.col)
  else if (move === 'right') moveCursor(cell.row, cell.col + 1)
  else focusGrid()
}

function moveCursor(row: number, col: number, extend = false): void {
  const target = {
    row: Math.max(0, Math.min(row, props.rows.length - 1)),
    col: Math.max(0, Math.min(col, props.columns.length - 1)),
  }
  cursor.value = target
  if (extend && anchor.value) {
    selection.value = [...selection.value.slice(0, -1), rangeBetween(anchor.value, target)]
  } else {
    anchor.value = { ...target }
    selection.value = [rangeBetween(target, target)]
  }
  editing.value = false
  focusGrid()
}

function toggleBoolean(): void {
  const cell = cursor.value
  const column = activeColumn.value
  if (!cell || column?.kind !== 'boolean') return
  const next = props.rows[cell.row]?.values[column.key] === false
  setCells(siblingsOfActive().map((target) => ({ ...target, value: next })))
}

/** Choosing an option fills every selected cell in that column — bulk assign. */
function pickOption(value: SheetValue): void {
  setCells(siblingsOfActive().map((target) => ({ ...target, value })))
  pickerOpen.value = false
  focusGrid()
}

const pickerFilter = ref('')
const pickerOptions = computed(() => {
  const options = activeColumn.value?.options ?? []
  const query = pickerFilter.value.trim().toLowerCase()
  return query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options
})
watch(pickerOpen, (open) => {
  if (!open) pickerFilter.value = ''
})

// ── clipboard, fill, delete ─────────────────────────────────────────────────
function clearSelection(): void {
  setCells(
    selectedCells(selection.value).map((cell) => ({
      ...cell,
      value: props.columns[cell.col]?.kind === 'boolean' ? false : null,
    })),
  )
}

function onCopy(event: ClipboardEvent): void {
  if (editing.value || !selection.value.length) return
  const cells = selectedCells(selection.value)
  const top = Math.min(...cells.map((cell) => cell.row))
  const bottom = Math.max(...cells.map((cell) => cell.row))
  const left = Math.min(...cells.map((cell) => cell.col))
  const right = Math.max(...cells.map((cell) => cell.col))
  const grid: string[][] = []
  for (let row = top; row <= bottom; row++) {
    const line: string[] = []
    for (let col = left; col <= right; col++) {
      const column = props.columns[col]
      line.push(column && isSelected(selection.value, row, col) ? cellText(row, column) : '')
    }
    grid.push(line)
  }
  event.clipboardData?.setData('text/plain', toClipboardGrid(grid))
  event.preventDefault()
}

function onPaste(event: ClipboardEvent): void {
  const cell = cursor.value
  if (!cell || editing.value || props.busy) return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text) return
  event.preventDefault()

  const source = parseClipboardGrid(text)
  const targets = pastePlan(source, cell, selection.value)
  if (!targets.length) return
  const lastRow = Math.max(...targets.map((target) => target.row))

  mutate((rows) => {
    // Grow the sheet when a pasted block runs past the last row.
    while (rows.length <= lastRow) rows.push(blankRow(props.columns, newRowSeq++))
    for (const target of targets) {
      const column = props.columns[target.col]
      const row = rows[target.row]
      if (column && row) row.values[column.key] = parseCell(column, target.text)
    }
  })
}

/** Continue each selected column downwards from the top of its selection. */
function fillDown(): void {
  const targets: Array<{ row: number; col: number; value: SheetValue }> = []
  for (const range of selection.value) {
    if (range.bottom === range.top) continue
    for (let col = range.left; col <= range.right; col++) {
      const column = props.columns[col]
      if (!column) continue
      const secondSeeded = cellText(range.top + 1, column) !== ''
      const seedCount = secondSeeded && range.top + 1 <= range.bottom ? 2 : 1
      const firstTarget = range.top + seedCount
      if (firstTarget > range.bottom) continue

      if (column.kind === 'text' || column.kind === 'number') {
        const seeds = Array.from({ length: seedCount }, (_, offset) =>
          cellText(range.top + offset, column),
        )
        extendSeries(seeds, range.bottom - firstTarget + 1).forEach((value, offset) =>
          targets.push({ row: firstTarget + offset, col, value: parseCell(column, value) }),
        )
      } else {
        const seed = props.rows[range.top]?.values[column.key] ?? null
        for (let row = firstTarget; row <= range.bottom; row++)
          targets.push({ row, col, value: seed })
      }
    }
  }
  setCells(targets)
}

/**
 * Copy the selected rows in immediately below themselves.
 *
 * A duplicate is a *new* row even when its source is saved: it drops the record
 * id and keeps the values, so saving it creates a second box rather than
 * rewriting the first. That's what makes it the fastest way to add "one more
 * like this one".
 */
function duplicateSelectedRows(): void {
  const indices = selectedRowIndices(selection.value)
  if (!indices.length) return
  const lowest = indices[0] as number
  mutate((rows) => {
    // Insert from the bottom up so earlier indices stay valid.
    for (const index of [...indices].reverse()) {
      const source = rows[index]
      if (!source) continue
      rows.splice(index + 1, 0, {
        key: `new:${newRowSeq++}`,
        values: { ...source.values },
      })
    }
  })
  void nextTick(() => moveCursor(lowest + 1, cursor.value?.col ?? 0))
}

// ── sorting ─────────────────────────────────────────────────────────────────
/** Which column the operator last sorted by, and in which direction. */
const sortKey = ref<string | null>(null)
const sortDescending = ref(false)

/**
 * Sort by a column, toggling direction on a repeat click.
 *
 * The rows array is genuinely reordered rather than sorted through a view, so
 * every index-based thing in the grid (selection, paste targets, fill-down)
 * keeps meaning what it says. It goes through `mutate`, so ⌘/Ctrl+Z puts the
 * old order back.
 */
function sortByColumn(column: SheetColumn): void {
  sortDescending.value = sortKey.value === column.key ? !sortDescending.value : false
  sortKey.value = column.key
  const direction = sortDescending.value ? -1 : 1
  mutate((rows) => {
    rows.sort((left, right) => {
      const a = left.values[column.key]
      const b = right.values[column.key]
      // Blanks sort last in both directions — an empty cell is "not yet filled
      // in", not a value that belongs at one end of the range.
      const aEmpty = a === null || a === undefined || a === ''
      const bEmpty = b === null || b === undefined || b === ''
      if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction
      if (typeof a === 'boolean' && typeof b === 'boolean') {
        return (Number(a) - Number(b)) * direction
      }
      // Numeric-aware so "Displej 2" precedes "Displej 10".
      return (
        formatCell(column, a).localeCompare(formatCell(column, b), undefined, { numeric: true }) *
        direction
      )
    })
  })
  selection.value = cursor.value ? [rangeBetween(cursor.value, cursor.value)] : []
}

// ── rows ────────────────────────────────────────────────────────────────────
/** A single blank row — for when there is no series to continue. */
function addEmptyRow(): void {
  mutate((rows) => rows.push(blankRow(props.columns, newRowSeq++)))
  void nextTick(() => moveCursor(props.rows.length, 0))
}

/** N rows continuing whatever series the sheet already holds. */
function addSeriesRows(count: number): void {
  const wanted = Math.max(1, Math.min(count, 500))
  mutate((rows) => {
    rows.push(...appendRows(rows, props.columns, wanted, newRowSeq))
    newRowSeq += wanted
  })
  void nextTick(() => moveCursor(props.rows.length - wanted, 0))
}

// ── keyboard ────────────────────────────────────────────────────────────────
/** ⌘/Ctrl chords. Returns true when the event was one of ours. */
function handleShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  if (key === 'z') {
    if (event.shiftKey) redo()
    else undo()
    return true
  }
  if (key === 'y') {
    redo()
    return true
  }
  if (key === 'd') {
    // Duplicating a row is the far more common ask in a sheet of hardware;
    // fill-down keeps ⌘/Ctrl+↓ and a context-menu entry.
    duplicateSelectedRows()
    return true
  }
  if (event.key === 'ArrowDown') {
    fillDown()
    return true
  }
  if (key === 'a') {
    selection.value = props.rows.map((_, index) => wholeRow(index, props.columns.length))
    return true
  }
  // Copy/paste/cut arrive as clipboard events, which carry the payload — let
  // them through rather than handling them blind here.
  return false
}

/** Plain navigation and editing keys. Returns true when the event was ours. */
function handleNavigation(event: KeyboardEvent, cell: CellRef): boolean {
  const step: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  const move = step[event.key]
  if (move) {
    moveCursor(cell.row + move[0], cell.col + move[1], event.shiftKey)
    return true
  }
  switch (event.key) {
    case 'Tab':
      moveCursor(cell.row, cell.col + (event.shiftKey ? -1 : 1))
      return true
    case 'Enter':
    case 'F2':
      startEditing()
      return true
    case ' ':
      if (activeColumn.value?.kind !== 'boolean') return false
      toggleBoolean()
      return true
    case 'Escape':
      selection.value = [rangeBetween(cell, cell)]
      anchor.value = { ...cell }
      return true
    case 'Backspace':
    case 'Delete':
      clearSelection()
      return true
    default:
      return false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (editing.value) return

  // Chords first, and without requiring a focused cell — undo has to work
  // straight after a sort, which leaves nothing selected.
  if (event.metaKey || event.ctrlKey) {
    if (handleShortcut(event)) event.preventDefault()
    return
  }
  const cell = cursor.value
  if (!cell) return
  if (handleNavigation(event, cell)) {
    event.preventDefault()
    return
  }
  // Any printable character starts an edit with that character, as in a sheet.
  if (!event.altKey && event.key.length === 1) {
    event.preventDefault()
    startEditing(event.key)
  }
}

onMounted(() => window.addEventListener('mouseup', stopDragging))
onBeforeUnmount(() => window.removeEventListener('mouseup', stopDragging))
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- What is selected, and what can be done to it. -->
    <div class="text-muted-foreground flex min-h-8 flex-wrap items-center gap-2 text-xs">
      <template v-if="selectedRows.length">
        <span class="text-foreground font-medium">
          {{ selectedRows.length }} row(s) · {{ selectedCells(selection).length }} cell(s)
        </span>
        <Button
          variant="ghost"
          size="sm"
          class="text-destructive h-7"
          @click="emit('delete', selectedRowKeys)"
        >
          <Trash2Icon class="size-3.5" />
          Delete rows
        </Button>
        <span class="opacity-70">
          Pick a value in a highlighted column to set it for every selected row
        </span>
      </template>
      <span v-else class="opacity-70">
        Drag to select · ⌘/Ctrl-click adds · ⌘/Ctrl+D duplicates · ⌘/Ctrl+↓ fills down · right-click
        for more · ⌘/Ctrl+Z undoes
      </span>
    </div>

    <div
      ref="gridRef"
      class="sheet max-h-[65vh] overflow-auto rounded-md border outline-none [&_[data-slot=table-container]]:overflow-visible"
      tabindex="0"
      @keydown="onKeydown"
      @copy="onCopy"
      @paste="onPaste"
    >
      <Table class="table-fixed">
        <colgroup>
          <col style="width: 3rem" />
          <col v-for="column in columns" :key="column.key" :style="{ width: widthOf(column) }" />
        </colgroup>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead
              :class="[STICKY_HEAD, 'cursor-pointer text-right text-xs font-normal select-none']"
              title="Select every row"
              @click="selectAllRows"
            >
              #
            </TableHead>
            <TableHead
              v-for="(column, colIndex) in columns"
              :key="column.key"
              :class="[STICKY_HEAD, 'text-foreground border-l select-none']"
              :title="column.description"
            >
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center text-left"
                  :title="`Select the ${column.label} column`"
                  @click="selectColumn(colIndex, $event.metaKey || $event.ctrlKey)"
                >
                  <span class="truncate">{{ column.label }}</span>
                  <span v-if="column.required && !column.requiredUnless" class="text-destructive">
                    *
                  </span>
                </button>
                <!-- Sorting is its own affordance so clicking the label can go
                     on selecting the column. -->
                <button
                  type="button"
                  class="hover:text-foreground shrink-0 opacity-60 hover:opacity-100"
                  :class="sortKey === column.key ? 'text-foreground opacity-100' : ''"
                  :aria-label="`Sort by ${column.label}`"
                  @click.stop="sortByColumn(column)"
                >
                  <ArrowUpIcon v-if="sortKey === column.key && !sortDescending" class="size-3.5" />
                  <ArrowDownIcon v-else-if="sortKey === column.key" class="size-3.5" />
                  <ChevronsUpDownIcon v-else class="size-3.5" />
                </button>
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          <ContextMenu v-for="(row, rowIndex) in rows" :key="row.key">
            <ContextMenuTrigger as-child>
              <TableRow
                :class="
                  dirtyKeys?.has(row.key)
                    ? 'bg-amber-50/60 hover:bg-amber-100/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/40'
                    : undefined
                "
                @contextmenu="onRowContextMenu(rowIndex)"
              >
                <!-- The row number is also the row handle: clicking it selects
                     the row, ⌘/Ctrl-click adds it to the selection. -->
                <TableCell
                  class="text-muted-foreground cursor-pointer text-right text-xs tabular-nums select-none"
                  :class="
                    isRowSelected(rowIndex) ? 'bg-primary/15 text-foreground font-medium' : ''
                  "
                  :aria-label="`Select row ${rowIndex + 1}`"
                  @click="toggleRow(rowIndex, $event.metaKey || $event.ctrlKey)"
                >
                  {{ rowIndex + 1 }}
                </TableCell>

                <TableCell
                  v-for="(column, colIndex) in columns"
                  :key="column.key"
                  class="cell relative border-l p-0"
                  :class="{
                    selected: isSelected(selection, rowIndex, colIndex),
                    cursor: cursor?.row === rowIndex && cursor?.col === colIndex,
                    invalid: !!cellError(rowIndex, column),
                  }"
                  :title="cellError(rowIndex, column) ?? undefined"
                  @mousedown="onCellMouseDown(rowIndex, colIndex, $event)"
                  @mouseenter="onCellMouseEnter(rowIndex, colIndex)"
                  @dblclick="startEditing()"
                >
                  <!-- The editor floats above the cell so the column never resizes.
                       Its Enter/Tab/Esc must not bubble: they clear `editing` on the
                       way out, so the grid's own handler would see a finished edit
                       and immediately start another one. -->
                  <input
                    v-if="editing && cursor?.row === rowIndex && cursor?.col === colIndex"
                    :ref="setEditorEl"
                    v-model="draft"
                    class="border-primary bg-background absolute top-0 left-0 z-30 h-8 w-[calc(100%+6rem)] max-w-[24rem] rounded-sm border px-2 shadow-lg outline-none"
                    @keydown.enter.prevent.stop="commitEdit('down')"
                    @keydown.tab.prevent.stop="commitEdit('right')"
                    @keydown.esc.prevent.stop="editing = false"
                    @blur="commitEdit()"
                  />

                  <!-- Categorical cells open the app's picker; a choice lands on every selected cell. -->
                  <Popover
                    v-else-if="
                      column.kind === 'select' &&
                      cursor?.row === rowIndex &&
                      cursor?.col === colIndex
                    "
                    :open="pickerOpen"
                    @update:open="pickerOpen = $event"
                  >
                    <PopoverTrigger as-child>
                      <button
                        type="button"
                        class="flex h-8 w-full items-center justify-between gap-1 px-2 text-left"
                        @click="pickerOpen = true"
                      >
                        <span class="truncate">{{ cellText(rowIndex, column) || '—' }}</span>
                        <ChevronDownIcon class="size-3.5 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent class="w-56 p-1" align="start">
                      <Input
                        v-if="(column.options?.length ?? 0) > 8"
                        v-model="pickerFilter"
                        placeholder="Search…"
                        class="mb-1 h-8"
                      />
                      <div class="max-h-64 overflow-y-auto">
                        <button
                          type="button"
                          class="hover:bg-accent flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm"
                          @click="pickOption(null)"
                        >
                          <span class="text-muted-foreground">—</span>
                          <CheckIcon v-if="!row.values[column.key]" class="size-3.5" />
                        </button>
                        <button
                          v-for="option in pickerOptions"
                          :key="option.value"
                          type="button"
                          class="hover:bg-accent flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm"
                          @click="pickOption(option.value)"
                        >
                          <span class="truncate">{{ option.label }}</span>
                          <CheckIcon
                            v-if="String(row.values[column.key] ?? '') === option.value"
                            class="size-3.5"
                          />
                        </button>
                        <p
                          v-if="!pickerOptions.length"
                          class="text-muted-foreground px-2 py-1.5 text-sm"
                        >
                          No match
                        </p>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <div
                    v-else-if="column.kind === 'boolean'"
                    class="flex h-8 items-center justify-center"
                  >
                    <Switch
                      :model-value="row.values[column.key] !== false"
                      @update:model-value="
                        setCells(
                          cursor?.row === rowIndex && cursor?.col === colIndex
                            ? siblingsOfActive().map((t) => ({ ...t, value: $event }))
                            : [{ row: rowIndex, col: colIndex, value: $event }],
                        )
                      "
                    />
                  </div>

                  <div v-else class="h-8 truncate px-2 leading-8">
                    {{ cellText(rowIndex, column) }}
                  </div>
                </TableCell>
              </TableRow>
            </ContextMenuTrigger>

            <ContextMenuContent class="w-48">
              <ContextMenuItem @select="duplicateSelectedRows">
                <CopyIcon />
                Duplicate {{ selectedRows.length > 1 ? `${selectedRows.length} rows` : 'row' }}
                <span class="text-muted-foreground ml-auto text-xs">⌘D</span>
              </ContextMenuItem>
              <ContextMenuItem @select="fillDown">
                <ArrowDownIcon />
                Fill down
                <span class="text-muted-foreground ml-auto text-xs">⌘↓</span>
              </ContextMenuItem>
              <ContextMenuItem @select="clearSelection">Clear cells</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" @select="emit('delete', selectedRowKeys)">
                <Trash2Icon />
                Delete {{ selectedRows.length > 1 ? `${selectedRows.length} rows` : 'row' }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <TableRow v-if="!rows.length" class="hover:bg-transparent">
            <TableCell :colspan="columns.length + 1" class="text-muted-foreground p-10 text-center">
              {{ emptyLabel }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <!-- Rows are added at the end of the sheet, where the next one would go. -->
      <div
        class="bg-background/80 sticky bottom-0 flex flex-wrap items-center gap-2 border-t px-2 py-1.5"
      >
        <Button variant="ghost" size="sm" class="h-7" :disabled="busy" @click="addEmptyRow">
          <PlusIcon class="size-3.5" />
          Add row
        </Button>
        <span class="text-muted-foreground text-xs">or</span>
        <Input
          v-model.number="addCount"
          type="number"
          min="1"
          max="500"
          class="h-7 w-16"
          aria-label="Rows to add"
        />
        <Button
          variant="ghost"
          size="sm"
          class="h-7"
          :disabled="busy"
          @click="addSeriesRows(addCount)"
        >
          <PlusIcon class="size-3.5" />
          Add continuing the series
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  /* A grid is only usable if a cell's state is legible at a glance: the cursor
     reads as a single outlined cell, the range as a wash, an invalid cell as a
     red field that survives both. */
  .cell {
    cursor: cell;
    user-select: none;

    &.selected {
      background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
    }

    &.cursor {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
      z-index: 10;
    }

    &.invalid {
      background-color: color-mix(in oklab, var(--color-destructive) 16%, transparent);
    }
  }
}
</style>

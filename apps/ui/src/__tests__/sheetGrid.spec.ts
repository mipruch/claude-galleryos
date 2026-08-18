/**
 * SheetGrid interaction tests.
 *
 * Every case here is a behaviour that was wrong (or missing) in the first cut
 * of the grid and got reported: a row selection that disagreed with the cell
 * selection, a second click that fell out of typing mode, no undo, no drag, a
 * paste that filled one cell out of thirty. They are written as
 * "what the operator does → what the sheet does".
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SheetGrid from '@/components/admin/bulk/SheetGrid.vue'
import type { SheetColumn, SheetRow } from '@/lib/bulkSheet'

const columns: SheetColumn[] = [
  { key: 'name', field: 'name', scope: 'device', label: 'Name', kind: 'text', fallback: '' },
  { key: 'host', field: 'host', scope: 'connection', label: 'Host', kind: 'text', fallback: '' },
  {
    key: 'port',
    field: 'port',
    scope: 'connection',
    label: 'Port',
    kind: 'number',
    fallback: 1515,
  },
  {
    key: 'roomId',
    field: 'roomId',
    scope: 'device',
    label: 'Room',
    kind: 'select',
    options: [
      { value: 'r1', label: 'Hall A' },
      { value: 'r2', label: 'Hall B' },
    ],
    fallback: null,
  },
  {
    key: 'enabled',
    field: 'enabled',
    scope: 'device',
    label: 'Enabled',
    kind: 'boolean',
    fallback: true,
  },
]

const COLUMN_COUNT = columns.length

const row = (key: string, name: string, host: string): SheetRow => ({
  key,
  values: { name, host, port: 1515, roomId: null, enabled: true },
})

let rows: SheetRow[]

beforeEach(() => {
  rows = [
    row('a', 'Displej 01', '10.0.1.1'),
    row('b', 'Displej 02', '10.0.1.2'),
    row('c', 'Displej 03', '10.0.1.3'),
  ]
})

/** Mount with a working v-model so emitted row updates come back as props. */
function mountGrid(initial: SheetRow[] = rows): VueWrapper {
  const wrapper: VueWrapper = mount(SheetGrid, {
    props: {
      columns,
      rows: initial,
      'onUpdate:rows': (next: SheetRow[]) => wrapper.setProps({ rows: next }),
    },
    attachTo: document.body,
  })
  return wrapper
}

const currentRows = (wrapper: VueWrapper): SheetRow[] =>
  (wrapper.props() as { rows: SheetRow[] }).rows
const cells = (wrapper: VueWrapper) => wrapper.findAll('tbody td.cell')
/** Index of the cell at (row, col) in the flat `td.cell` list. */
const at = (rowIndex: number, colIndex: number): number => rowIndex * COLUMN_COUNT + colIndex
/** The row number doubles as the row handle. */
const rowHandles = (wrapper: VueWrapper) => wrapper.findAll('tbody [aria-label^="Select row"]')

const paste = async (wrapper: VueWrapper, text: string): Promise<void> => {
  await wrapper.find('.sheet').trigger('paste', { clipboardData: { getData: () => text } })
}

describe('selection', () => {
  it('sweeps a range when the pointer is dragged across cells', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 1)]!.trigger('mouseenter')

    // Two columns × three rows are highlighted, not just the one clicked.
    expect(wrapper.findAll('td.cell.selected')).toHaveLength(6)
  })

  it('adds a disjoint block on ⌘/Ctrl-click, so rows 1 and 3 is expressible', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 0)]!.trigger('mousedown', { metaKey: true })

    const selected = wrapper.findAll('td.cell.selected')
    expect(selected).toHaveLength(2)
    // …and the row in between is untouched.
    expect(cells(wrapper)[at(1, 0)]!.classes()).not.toContain('selected')
  })

  it('marks the row number of every row whose cells are selected', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(1, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 0)]!.trigger('mousedown', { metaKey: true })

    // Rows 2 and 3 read as selected because their cells are — there is no
    // second, invisible selection a delete could act on instead.
    expect(rowHandles(wrapper)[0]!.classes()).not.toContain('bg-primary/15')
    expect(rowHandles(wrapper)[1]!.classes()).toContain('bg-primary/15')
    expect(rowHandles(wrapper)[2]!.classes()).toContain('bg-primary/15')
  })

  it('has no checkbox column — the row number is the handle', () => {
    const wrapper = mountGrid()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(rowHandles(wrapper)[0]!.text()).toBe('1')
  })

  it('deletes exactly the rows that are highlighted', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(1, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 2)]!.trigger('mouseenter')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Delete rows'))!
      .trigger('click')

    expect(wrapper.emitted('delete')?.[0]).toEqual([['b', 'c']])
  })

  it('clicking a row number selects that row’s cells', async () => {
    const wrapper = mountGrid()

    await rowHandles(wrapper)[1]!.trigger('click')

    expect(wrapper.findAll('td.cell.selected')).toHaveLength(COLUMN_COUNT)
    expect(cells(wrapper)[at(1, 0)]!.classes()).toContain('selected')
  })

  it('selects a whole column from its header', async () => {
    const wrapper = mountGrid()

    // th[0] is the row-number header; th[1] is the first data column.
    await wrapper.findAll('thead th')[2]!.find('button').trigger('click')

    expect(wrapper.findAll('td.cell.selected')).toHaveLength(3)
  })
})

describe('editing', () => {
  it('stays in the editor when the same cell is clicked again', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(0, 0)]!.trigger('dblclick')
    expect(wrapper.find('tbody input').exists()).toBe(true)

    // Clicking inside the cell being edited (e.g. to place the caret) used to
    // tear the editor down.
    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    expect(wrapper.find('tbody input').exists()).toBe(true)
  })

  it('commits an edit once, not into the next cell as well', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(0, 0)]!.trigger('dblclick')
    const editor = wrapper.find('tbody input')
    await editor.setValue('Renamed')
    await editor.trigger('keydown', { key: 'Enter' })
    await editor.trigger('blur')

    expect(currentRows(wrapper)[0]!.values.name).toBe('Renamed')
    expect(currentRows(wrapper)[1]!.values.name).toBe('Displej 02')
  })
})

describe('undo', () => {
  it('takes back an edit on ⌘/Ctrl+Z, and redo puts it back', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(0, 0)]!.trigger('dblclick')
    const editor = wrapper.find('tbody input')
    await editor.setValue('Renamed')
    await editor.trigger('keydown', { key: 'Enter' })
    expect(currentRows(wrapper)[0]!.values.name).toBe('Renamed')

    await wrapper.find('.sheet').trigger('keydown', { key: 'z', metaKey: true })
    expect(currentRows(wrapper)[0]!.values.name).toBe('Displej 01')

    await wrapper.find('.sheet').trigger('keydown', { key: 'z', metaKey: true, shiftKey: true })
    expect(currentRows(wrapper)[0]!.values.name).toBe('Renamed')
  })

  it('takes back a whole paste as one step', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await paste(wrapper, 'A\nB\nC')
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual(['A', 'B', 'C'])

    await wrapper.find('.sheet').trigger('keydown', { key: 'z', metaKey: true })
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 01',
      'Displej 02',
      'Displej 03',
    ])
  })
})

describe('clipboard', () => {
  it('repeats a single copied cell across the whole selection', async () => {
    const wrapper = mountGrid()

    // Select the Host column's three cells, then paste one value.
    await cells(wrapper)[at(0, 1)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 1)]!.trigger('mouseenter')
    await paste(wrapper, '10.0.9.9')

    expect(currentRows(wrapper).map((r) => r.values.host)).toEqual([
      '10.0.9.9',
      '10.0.9.9',
      '10.0.9.9',
    ])
  })

  it('lays a block down from the cursor and grows the sheet to fit', async () => {
    const wrapper = mountGrid([row('a', 'One', '10.0.1.1')])

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await paste(wrapper, 'Alpha\t10.0.2.1\nBeta\t10.0.2.2\nGamma\t10.0.2.3')

    expect(currentRows(wrapper)).toHaveLength(3)
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(currentRows(wrapper).map((r) => r.values.host)).toEqual([
      '10.0.2.1',
      '10.0.2.2',
      '10.0.2.3',
    ])
  })
})

describe('fill down', () => {
  it('continues the series through the selection on ⌘/Ctrl+D', async () => {
    const wrapper = mountGrid([
      row('a', 'Displej 01', '10.0.1.1'),
      { key: 'b', values: { name: '', host: '', port: 1515, roomId: null, enabled: true } },
      { key: 'c', values: { name: '', host: '', port: 1515, roomId: null, enabled: true } },
    ])

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 1)]!.trigger('mouseenter')
    await wrapper.find('.sheet').trigger('keydown', { key: 'ArrowDown', metaKey: true })

    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 01',
      'Displej 02',
      'Displej 03',
    ])
    expect(currentRows(wrapper).map((r) => r.values.host)).toEqual([
      '10.0.1.1',
      '10.0.1.2',
      '10.0.1.3',
    ])
  })
})

describe('categorical cells', () => {
  it('sets every selected cell in the column from one pick', async () => {
    const wrapper = mountGrid()

    // Select the Room column across all three rows, then open the picker.
    await cells(wrapper)[at(0, 3)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 3)]!.trigger('mouseenter')
    // The picker opens on the cursor cell, which the drag left on the last row.
    await cells(wrapper)[at(2, 3)]!.find('button').trigger('click')
    const option = document.body.querySelectorAll('button')
    const hallB = [...option].find((button) => button.textContent?.trim() === 'Hall B')
    hallB?.click()
    await wrapper.vm.$nextTick()

    // One click, three rows — no separate "assign room" control anywhere.
    expect(currentRows(wrapper).map((r) => r.values.roomId)).toEqual(['r2', 'r2', 'r2'])
  })
})

describe('adding rows', () => {
  it('adds one empty row at the bottom', async () => {
    const wrapper = mountGrid()

    await wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Add row')!
      .trigger('click')

    const next = currentRows(wrapper)
    expect(next).toHaveLength(4)
    // Empty means empty — it continues nothing.
    expect(next[3]!.values.name).toBe('')
    expect(next[3]!.values.host).toBe('')
    // …but a column's declared fallback still applies.
    expect(next[3]!.values.port).toBe(1515)
  })

  it('adds rows that continue the series when asked to', async () => {
    const wrapper = mountGrid()

    await wrapper.find('input[aria-label="Rows to add"]').setValue('2')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('continuing the series'))!
      .trigger('click')

    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 01',
      'Displej 02',
      'Displej 03',
      'Displej 04',
      'Displej 05',
    ])
  })
})

describe('columns', () => {
  it('shows every column — nothing is hidden behind a toggle', () => {
    const wrapper = mountGrid()

    const headers = wrapper.findAll('thead th').map((th) => th.text().replace('*', '').trim())
    expect(headers).toEqual(['#', 'Name', 'Host', 'Port', 'Room', 'Enabled'])
  })

  it('lays out at fixed widths so a column never moves while typing', () => {
    const wrapper = mountGrid()

    expect(wrapper.find('table').classes()).toContain('table-fixed')
    expect(wrapper.findAll('colgroup col')).toHaveLength(COLUMN_COUNT + 1)
  })
})

describe('duplicating rows', () => {
  it('copies the selected row in directly below it on ⌘/Ctrl+D', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(1, 0)]!.trigger('mousedown')
    await wrapper.find('.sheet').trigger('keydown', { key: 'd', metaKey: true })

    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 01',
      'Displej 02',
      'Displej 02',
      'Displej 03',
    ])
  })

  it('gives the copy a fresh identity, so saving it creates a second record', async () => {
    const wrapper = mountGrid([
      {
        key: 'saved',
        connectionId: 'c1',
        values: { name: 'One', host: '', port: 1515, roomId: null, enabled: true },
      },
    ])

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await wrapper.find('.sheet').trigger('keydown', { key: 'd', metaKey: true })

    const [original, copy] = currentRows(wrapper)
    expect(original!.connectionId).toBe('c1')
    expect(copy!.connectionId).toBeUndefined()
    expect(copy!.values.name).toBe('One')
  })

  it('duplicates every selected row, keeping each copy under its source', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await cells(wrapper)[at(2, 0)]!.trigger('mousedown', { metaKey: true })
    await wrapper.find('.sheet').trigger('keydown', { key: 'd', metaKey: true })

    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 01',
      'Displej 01',
      'Displej 02',
      'Displej 03',
      'Displej 03',
    ])
  })

  it('is undoable like any other change', async () => {
    const wrapper = mountGrid()

    await cells(wrapper)[at(0, 0)]!.trigger('mousedown')
    await wrapper.find('.sheet').trigger('keydown', { key: 'd', metaKey: true })
    expect(currentRows(wrapper)).toHaveLength(4)

    await wrapper.find('.sheet').trigger('keydown', { key: 'z', metaKey: true })
    expect(currentRows(wrapper)).toHaveLength(3)
  })
})

describe('sorting', () => {
  const sortButton = (wrapper: VueWrapper, label: string) =>
    wrapper.find(`thead button[aria-label="Sort by ${label}"]`)

  it('sorts by a column, and reverses on a second click', async () => {
    const wrapper = mountGrid([
      row('a', 'Displej 10', '10.0.1.10'),
      row('b', 'Displej 2', '10.0.1.2'),
      row('c', 'Displej 1', '10.0.1.1'),
    ])

    await sortButton(wrapper, 'Name').trigger('click')
    // Numeric-aware: 2 comes before 10.
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 1',
      'Displej 2',
      'Displej 10',
    ])

    await sortButton(wrapper, 'Name').trigger('click')
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 10',
      'Displej 2',
      'Displej 1',
    ])
  })

  it('keeps blank cells at the bottom in either direction', async () => {
    const wrapper = mountGrid([
      row('a', 'Beta', '10.0.1.2'),
      { key: 'b', values: { name: '', host: '', port: 1515, roomId: null, enabled: true } },
      row('c', 'Alpha', '10.0.1.1'),
    ])

    await sortButton(wrapper, 'Name').trigger('click')
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual(['Alpha', 'Beta', ''])

    await sortButton(wrapper, 'Name').trigger('click')
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual(['Beta', 'Alpha', ''])
  })

  it('is undoable, so a sort never costs the operator their own order', async () => {
    const wrapper = mountGrid()

    await sortButton(wrapper, 'Name').trigger('click')
    await sortButton(wrapper, 'Name').trigger('click')
    expect(currentRows(wrapper)[0]!.values.name).toBe('Displej 03')

    await wrapper.find('.sheet').trigger('keydown', { key: 'z', metaKey: true })
    await wrapper.find('.sheet').trigger('keydown', { key: 'z', metaKey: true })
    expect(currentRows(wrapper).map((r) => r.values.name)).toEqual([
      'Displej 01',
      'Displej 02',
      'Displej 03',
    ])
  })

  it('leaves the column selectable — sorting has a control of its own', async () => {
    const wrapper = mountGrid()

    await wrapper.findAll('thead th')[1]!.find('button').trigger('click')

    expect(wrapper.findAll('td.cell.selected')).toHaveLength(3)
  })
})

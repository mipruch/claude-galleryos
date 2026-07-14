import { describe, expect, it } from 'vitest'
import { emptyAction } from '@/lib/sceneActions'
import {
  buildRoutingGraph,
  buildSceneStageGraph,
  columnIndexFromX,
  distinctGroups,
  orderActionsForSave,
  parseNodeId,
  unplacedLibraryItems,
} from '@/lib/workflowGraph'
import { makeDevice, makeMapping, makeSchedule, makeScene, makeTriggerAction } from './fixtures'

describe('parseNodeId', () => {
  it('splits a namespaced id into kind and value', () => {
    expect(parseNodeId('mapping:abc-123')).toEqual({ kind: 'mapping', value: 'abc-123' })
  })

  it('treats an id with no colon as a bare kind', () => {
    expect(parseNodeId('start')).toEqual({ kind: 'start', value: '' })
  })

  it('only splits on the first colon (a uuid embeds no colon, but a trigger-action edge id does)', () => {
    expect(parseNodeId('trigger-action:ta1')).toEqual({ kind: 'trigger-action', value: 'ta1' })
  })
})

describe('buildRoutingGraph', () => {
  it('renders a bare trigger with no wired actions and no edges', () => {
    const mapping = makeMapping({ id: 'm1' })
    const { nodes, edges } = buildRoutingGraph({ mappings: [mapping], schedules: [], triggerActions: [], scenes: [], devices: [] })

    expect(nodes.map((n) => n.id)).toEqual(['mapping:m1'])
    expect(edges).toEqual([])
  })

  it('connects a mapping-owned scene.execute action straight from trigger to scene', () => {
    const mapping = makeMapping({ id: 'm1' })
    const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', targetType: 'scene.execute', targetId: 's1' })
    const { nodes, edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [action],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['mapping:m1', 'scene:s1']))
    expect(edges).toEqual([
      { id: 'trigger-action:ta1', source: 'mapping:m1', target: 'scene:s1', data: { triggerAction: action } },
    ])
  })

  it('connects a device.command action straight from trigger to device', () => {
    const mapping = makeMapping({ id: 'm1' })
    const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', targetType: 'device.command', targetId: 'd1', targetCommand: 'on' })
    const { nodes, edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [action],
      scenes: [],
      devices: [makeDevice({ id: 'd1' })],
    })

    expect(nodes.some((n) => n.id === 'device:d1')).toBe(true)
    expect(edges).toEqual([
      { id: 'trigger-action:ta1', source: 'mapping:m1', target: 'device:d1', data: { triggerAction: action } },
    ])
  })

  it('omits the edge for an unwired action (no targetId) — nothing sane to draw', () => {
    const mapping = makeMapping({ id: 'm1' })
    const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', targetType: 'device.command', targetId: null })
    const { nodes, edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [action],
      scenes: [],
      devices: [],
    })

    expect(edges).toEqual([])
    // No device node either — nothing resolves to one, and none was placed.
    expect(nodes.map((n) => n.id)).toEqual(['mapping:m1'])
  })

  it('connects a schedule-owned action the same way as a mapping-owned one', () => {
    const schedule = makeSchedule({ id: 'j1' })
    const action = makeTriggerAction({ id: 'ta1', scheduleId: 'j1', mappingId: null, targetType: 'scene.execute', targetId: 's1' })
    const { edges } = buildRoutingGraph({
      mappings: [],
      schedules: [schedule],
      triggerActions: [action],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    expect(edges).toEqual([
      { id: 'trigger-action:ta1', source: 'schedule:j1', target: 'scene:s1', data: { triggerAction: action } },
    ])
  })

  it('fans one trigger out to several targets (N wires from one trigger)', () => {
    const schedule = makeSchedule({ id: 'j1' })
    const actions = [
      makeTriggerAction({ id: 'ta1', scheduleId: 'j1', targetType: 'scene.execute', targetId: 's1' }),
      makeTriggerAction({ id: 'ta2', scheduleId: 'j1', targetType: 'scene.execute', targetId: 's2' }),
      makeTriggerAction({ id: 'ta3', scheduleId: 'j1', targetType: 'device.command', targetId: 'd1', targetCommand: 'on' }),
    ]
    const { edges } = buildRoutingGraph({
      mappings: [],
      schedules: [schedule],
      triggerActions: actions,
      scenes: [makeScene({ id: 's1' }), makeScene({ id: 's2' })],
      devices: [makeDevice({ id: 'd1' })],
    })

    const fromSchedule = edges.filter((e) => e.source === 'schedule:j1')
    expect(fromSchedule).toHaveLength(3)
    expect(fromSchedule.map((e) => e.target)).toEqual(expect.arrayContaining(['scene:s1', 'scene:s2', 'device:d1']))
  })

  it('fans multiple triggers into one target (N:1 — many inputs to a scene/device)', () => {
    const mapping = makeMapping({ id: 'm1' })
    const schedule = makeSchedule({ id: 'j1' })
    const actions = [
      makeTriggerAction({ id: 'ta1', mappingId: 'm1', targetType: 'scene.execute', targetId: 's1' }),
      makeTriggerAction({ id: 'ta2', scheduleId: 'j1', mappingId: null, targetType: 'scene.execute', targetId: 's1' }),
    ]
    const { edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [schedule],
      triggerActions: actions,
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    const toScene = edges.filter((e) => e.target === 'scene:s1')
    expect(toScene.map((e) => e.source)).toEqual(expect.arrayContaining(['mapping:m1', 'schedule:j1']))
  })

  it('only shows a scene once it has a saved position or some action targets it', () => {
    const { nodes } = buildRoutingGraph({
      mappings: [],
      schedules: [],
      triggerActions: [],
      scenes: [makeScene({ id: 's1', position: null }), makeScene({ id: 's2', position: { x: 10, y: 20 } })],
      devices: [],
    })

    expect(nodes.some((n) => n.id === 'scene:s1')).toBe(false)
    expect(nodes.some((n) => n.id === 'scene:s2')).toBe(true)
  })

  it('only shows a device once it has a saved position or some action targets it', () => {
    const mapping = makeMapping({ id: 'm1' })
    const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', targetType: 'device.command', targetId: 'd1' })
    const { nodes } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [action],
      scenes: [],
      devices: [makeDevice({ id: 'd1', position: null }), makeDevice({ id: 'd2', position: null })],
    })

    expect(nodes.some((n) => n.id === 'device:d1')).toBe(true) // wired to by ta1
    expect(nodes.some((n) => n.id === 'device:d2')).toBe(false) // neither placed nor wired
  })

  it('keeps a saved trigger position instead of auto-layouting it', () => {
    const mapping = makeMapping({ id: 'm1', position: { x: 42, y: 99 } })
    const { nodes } = buildRoutingGraph({ mappings: [mapping], schedules: [], triggerActions: [], scenes: [], devices: [] })

    expect(nodes.find((n) => n.id === 'mapping:m1')?.position).toEqual({ x: 42, y: 99 })
  })

  it('keeps a saved target position instead of auto-layouting it (the drag-to-place fix)', () => {
    const scene = makeScene({ id: 's1', position: { x: 7, y: 13 } })
    const { nodes } = buildRoutingGraph({ mappings: [], schedules: [], triggerActions: [], scenes: [scene], devices: [] })

    expect(nodes.find((n) => n.id === 'scene:s1')?.position).toEqual({ x: 7, y: 13 })
  })

  it('auto-layouts multiple unpinned triggers to distinct positions, not all stacked together', () => {
    // Regression test: dagre writes each node's computed x/y back onto the
    // exact object passed to setNode, so sharing one size object across every
    // setNode call let the last-processed node's position silently overwrite
    // what every other node's lookup also pointed to — all nodes rendered on
    // top of each other. Three separate schedule->scene chains (no shared
    // targets) makes that collapse obvious: every trigger would land at the
    // same spot instead of three distinct ones.
    const schedules = [
      makeSchedule({ id: 'j1', position: null }),
      makeSchedule({ id: 'j2', position: null }),
      makeSchedule({ id: 'j3', position: null }),
    ]
    const triggerActions = [
      makeTriggerAction({ id: 'ta1', scheduleId: 'j1', targetType: 'scene.execute', targetId: 's1' }),
      makeTriggerAction({ id: 'ta2', scheduleId: 'j2', targetType: 'scene.execute', targetId: 's2' }),
      makeTriggerAction({ id: 'ta3', scheduleId: 'j3', targetType: 'scene.execute', targetId: 's3' }),
    ]
    const scenes = [makeScene({ id: 's1' }), makeScene({ id: 's2' }), makeScene({ id: 's3' })]
    const { nodes } = buildRoutingGraph({ mappings: [], schedules, triggerActions, scenes, devices: [] })

    const positions = ['schedule:j1', 'schedule:j2', 'schedule:j3'].map(
      (id) => nodes.find((n) => n.id === id)?.position,
    )
    const distinct = new Set(positions.map((p) => `${p?.x},${p?.y}`))
    expect(distinct.size).toBe(3)
  })
})

describe('unplacedLibraryItems', () => {
  it('lists every scene/device with no saved position and no wiring', () => {
    const { scenes, devices } = unplacedLibraryItems({
      mappings: [],
      schedules: [],
      triggerActions: [],
      scenes: [makeScene({ id: 's1', position: null })],
      devices: [makeDevice({ id: 'd1', position: null })],
    })

    expect(scenes.map((s) => s.id)).toEqual(['s1'])
    expect(devices.map((d) => d.id)).toEqual(['d1'])
  })

  it('excludes a scene/device that already has a saved position', () => {
    const { scenes, devices } = unplacedLibraryItems({
      mappings: [],
      schedules: [],
      triggerActions: [],
      scenes: [makeScene({ id: 's1', position: { x: 1, y: 2 } })],
      devices: [makeDevice({ id: 'd1', position: { x: 3, y: 4 } })],
    })

    expect(scenes).toEqual([])
    expect(devices).toEqual([])
  })

  it('excludes a scene/device some trigger action already targets, even with no saved position', () => {
    const mapping = makeMapping({ id: 'm1' })
    const actions = [
      makeTriggerAction({ id: 'ta1', mappingId: 'm1', targetType: 'scene.execute', targetId: 's1' }),
      makeTriggerAction({ id: 'ta2', mappingId: 'm1', targetType: 'device.command', targetId: 'd1' }),
    ]
    const { scenes, devices } = unplacedLibraryItems({
      mappings: [mapping],
      schedules: [],
      triggerActions: actions,
      scenes: [makeScene({ id: 's1', position: null })],
      devices: [makeDevice({ id: 'd1', position: null })],
    })

    expect(scenes).toEqual([])
    expect(devices).toEqual([])
  })
})

describe('distinctGroups', () => {
  it('returns sorted unique parallelGroup values', () => {
    const actions = [
      { ...emptyAction(), parallelGroup: '2' },
      { ...emptyAction(), parallelGroup: '0' },
      { ...emptyAction(), parallelGroup: '2' },
    ]
    expect(distinctGroups(actions)).toEqual([0, 2])
  })

  it('treats a blank parallelGroup as 0', () => {
    expect(distinctGroups([{ ...emptyAction(), parallelGroup: '' }])).toEqual([0])
  })
})

describe('columnIndexFromX', () => {
  it('rounds to the nearest column centre', () => {
    expect(columnIndexFromX(280, 3)).toBe(0)
  })

  it('clamps to the existing column range', () => {
    expect(columnIndexFromX(-500, 3)).toBe(0)
    expect(columnIndexFromX(10000, 3)).toBe(2)
  })

  it('has nothing to clamp into on an empty scene', () => {
    expect(columnIndexFromX(500, 0)).toBe(0)
  })
})

describe('buildSceneStageGraph', () => {
  it('always renders a start node and an add-stage button, even with no actions', () => {
    const { nodes, columnCount } = buildSceneStageGraph([])
    expect(nodes.map((n) => n.id)).toEqual(['start', 'add-stage'])
    expect(columnCount).toBe(0)
  })

  it('groups actions into one stage column per distinct parallelGroup', () => {
    const actions = [
      { ...emptyAction(), key: 'a', parallelGroup: '0' },
      { ...emptyAction(), key: 'b', parallelGroup: '0' },
      { ...emptyAction(), key: 'c', parallelGroup: '1' },
    ]
    const { nodes, columnCount } = buildSceneStageGraph(actions)

    expect(columnCount).toBe(2)
    expect(nodes.filter((n) => n.type === 'action')).toHaveLength(3)
    expect(nodes.find((n) => n.id === 'stage:0')?.data).toMatchObject({ kind: 'stage', groupIndex: 0, count: 2 })
  })

  it('adds an add-action button per stage and one trailing add-stage button', () => {
    const actions = [
      { ...emptyAction(), key: 'a', parallelGroup: '0' },
      { ...emptyAction(), key: 'b', parallelGroup: '1' },
    ]
    const { nodes } = buildSceneStageGraph(actions)

    expect(nodes.find((n) => n.id === 'add-action:0')?.data).toEqual({ kind: 'add-action', groupIndex: 0 })
    expect(nodes.find((n) => n.id === 'add-action:1')?.data).toEqual({ kind: 'add-action', groupIndex: 1 })
    expect(nodes.find((n) => n.id === 'add-stage')?.data).toEqual({ kind: 'add-stage' })
  })

  it('never lets two actions in the same stage share a render position, even when one has a stale saved y close to another', () => {
    const actions = [
      { ...emptyAction(), key: 'a', parallelGroup: '0', position: null },
      { ...emptyAction(), key: 'b', parallelGroup: '0', position: { x: 0, y: 133.76 } },
    ]
    const { nodes } = buildSceneStageGraph(actions)
    const positions = nodes.filter((n) => n.type === 'action').map((n) => `${n.position.x},${n.position.y}`)
    expect(new Set(positions).size).toBe(2)
  })
})

describe('orderActionsForSave', () => {
  it('orders by parallelGroup ascending, then by canvas y', () => {
    const a = { ...emptyAction(), key: 'a', parallelGroup: '1', position: { x: 0, y: 50 } }
    const b = { ...emptyAction(), key: 'b', parallelGroup: '0', position: { x: 0, y: 10 } }
    const c = { ...emptyAction(), key: 'c', parallelGroup: '0', position: { x: 0, y: 5 } }

    expect(orderActionsForSave([a, b, c]).map((x) => x.key)).toEqual(['c', 'b', 'a'])
  })
})

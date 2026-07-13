import { describe, expect, it } from 'vitest'
import { emptyAction } from '@/lib/sceneActions'
import {
  buildRoutingGraph,
  buildSceneStageGraph,
  columnIndexFromX,
  distinctGroups,
  orderActionsForSave,
  parseNodeId,
} from '@/lib/workflowGraph'
import { makeDevice, makeMapping, makeSchedule, makeScene } from './fixtures'

describe('parseNodeId', () => {
  it('splits a namespaced id into kind and value', () => {
    expect(parseNodeId('mapping:abc-123')).toEqual({ kind: 'mapping', value: 'abc-123' })
  })

  it('treats an id with no colon as a bare kind', () => {
    expect(parseNodeId('start')).toEqual({ kind: 'start', value: '' })
  })
})

describe('buildRoutingGraph', () => {
  it('connects a scene.execute mapping to its scene', () => {
    const mapping = makeMapping({ id: 'm1', targetType: 'scene.execute', targetId: 's1' })
    const { nodes, edges } = buildRoutingGraph({ mappings: [mapping], schedules: [], scenes: [makeScene({ id: 's1' })], devices: [] })

    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['mapping:m1', 'scene:s1']))
    expect(edges).toEqual([{ id: 'mapping:m1->scene:s1', source: 'mapping:m1', target: 'scene:s1' }])
  })

  it('connects a device.command mapping to its device', () => {
    const mapping = makeMapping({ id: 'm1', targetType: 'device.command', targetId: 'd1', targetCommand: 'on' })
    const { nodes, edges } = buildRoutingGraph({ mappings: [mapping], schedules: [], scenes: [], devices: [makeDevice({ id: 'd1' })] })

    expect(nodes.some((n) => n.id === 'device:d1')).toBe(true)
    expect(edges).toEqual([{ id: 'mapping:m1->device:d1', source: 'mapping:m1', target: 'device:d1' }])
  })

  it('gives an event.emit mapping its own terminal node', () => {
    const mapping = makeMapping({ id: 'm1', targetType: 'event.emit', targetId: null, targetCommand: null })
    const { nodes, edges } = buildRoutingGraph({ mappings: [mapping], schedules: [], scenes: [], devices: [] })

    expect(nodes.some((n) => n.id === 'event:m1')).toBe(true)
    expect(edges).toEqual([{ id: 'mapping:m1->event:m1', source: 'mapping:m1', target: 'event:m1' }])
  })

  it('leaves a mapping with no resolved target as a dangling trigger node', () => {
    const mapping = makeMapping({ id: 'm1', targetType: 'device.command', targetId: null, targetCommand: null })
    const { nodes, edges } = buildRoutingGraph({ mappings: [mapping], schedules: [], scenes: [], devices: [] })

    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
  })

  it('connects a schedule to its scene', () => {
    const schedule = makeSchedule({ id: 'j1', sceneId: 's1' })
    const { nodes, edges } = buildRoutingGraph({ mappings: [], schedules: [schedule], scenes: [makeScene({ id: 's1' })], devices: [] })

    expect(nodes.some((n) => n.id === 'schedule:j1')).toBe(true)
    expect(edges).toEqual([{ id: 'schedule:j1->scene:s1', source: 'schedule:j1', target: 'scene:s1' }])
  })

  it('keeps a saved trigger position instead of auto-layouting it', () => {
    const mapping = makeMapping({ id: 'm1', position: { x: 42, y: 99 } })
    const { nodes } = buildRoutingGraph({ mappings: [mapping], schedules: [], scenes: [makeScene()], devices: [] })

    expect(nodes.find((n) => n.id === 'mapping:m1')?.position).toEqual({ x: 42, y: 99 })
  })

  it('auto-layouts multiple unpinned triggers to distinct positions, not all stacked together', () => {
    // Regression test: dagre writes each node's computed x/y back onto the
    // exact object passed to setNode, so sharing one size object across every
    // setNode call let the last-processed node's position silently overwrite
    // what every other node's lookup also pointed to — all nodes rendered on
    // top of each other. Three separate schedule->scene pairs (no shared
    // targets) makes that collapse obvious: every trigger would land at the
    // same spot instead of three distinct ones.
    const schedules = [
      makeSchedule({ id: 'j1', sceneId: 's1', position: null }),
      makeSchedule({ id: 'j2', sceneId: 's2', position: null }),
      makeSchedule({ id: 'j3', sceneId: 's3', position: null }),
    ]
    const scenes = [makeScene({ id: 's1' }), makeScene({ id: 's2' }), makeScene({ id: 's3' })]
    const { nodes } = buildRoutingGraph({ mappings: [], schedules, scenes, devices: [] })

    const positions = ['schedule:j1', 'schedule:j2', 'schedule:j3'].map(
      (id) => nodes.find((n) => n.id === id)?.position,
    )
    const distinct = new Set(positions.map((p) => `${p?.x},${p?.y}`))
    expect(distinct.size).toBe(3)
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

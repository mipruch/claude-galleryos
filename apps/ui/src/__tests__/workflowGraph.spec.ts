import { describe, expect, it } from 'vitest'
import { emptyAction } from '@/lib/sceneActions'
import {
  buildRoutingGraph,
  buildSceneStageGraph,
  columnIndexFromX,
  distinctGroups,
  orderActionsForSave,
  parseNodeId,
  patternParamNames,
} from '@/lib/workflowGraph'
import { makeDevice, makeMapping, makeSchedule, makeScene, makeTriggerAction, makeWorkflowTarget } from './fixtures'

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

describe('patternParamNames', () => {
  it('extracts a single named segment', () => {
    expect(patternParamNames('/dim/:level')).toEqual(['level'])
  })

  it('extracts several named segments in order', () => {
    expect(patternParamNames('/room/:roomId/device/:deviceId')).toEqual(['roomId', 'deviceId'])
  })

  it('returns nothing for a pattern with no named segments', () => {
    expect(patternParamNames('/scene/execute')).toEqual([])
  })
})

describe('buildRoutingGraph', () => {
  it('renders a bare trigger with no wired actions and no edges', () => {
    const mapping = makeMapping({ id: 'm1' })
    const { nodes, edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [],
      workflowTargets: [],
      scenes: [],
      devices: [],
    })

    expect(nodes.map((n) => n.id)).toEqual(['mapping:m1'])
    expect(edges).toEqual([])
  })

  it('every workflow target renders as a node unconditionally, wired or not (existence is placement)', () => {
    const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
    const { nodes } = buildRoutingGraph({
      mappings: [],
      schedules: [],
      triggerActions: [],
      workflowTargets: [target],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    expect(nodes.map((n) => n.id)).toEqual(['target:wt1'])
  })

  it('connects a mapping-owned action straight from trigger to its workflow target', () => {
    const mapping = makeMapping({ id: 'm1' })
    const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
    const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', workflowTargetId: 'wt1' })
    const { nodes, edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [action],
      workflowTargets: [target],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['mapping:m1', 'target:wt1']))
    expect(edges).toEqual([
      { id: 'trigger-action:ta1', type: 'trigger-action', source: 'mapping:m1', target: 'target:wt1', data: { triggerAction: action, signalArgs: [] } },
    ])
  })

  it('connects a schedule-owned action the same way as a mapping-owned one', () => {
    const schedule = makeSchedule({ id: 'j1' })
    const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
    const action = makeTriggerAction({ id: 'ta1', scheduleId: 'j1', mappingId: null, workflowTargetId: 'wt1' })
    const { edges } = buildRoutingGraph({
      mappings: [],
      schedules: [schedule],
      triggerActions: [action],
      workflowTargets: [target],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    expect(edges).toEqual([
      { id: 'trigger-action:ta1', type: 'trigger-action', source: 'schedule:j1', target: 'target:wt1', data: { triggerAction: action, signalArgs: [] } },
    ])
  })

  it('two instances of the same device are two independent target nodes', () => {
    const device = makeDevice({ id: 'd1' })
    const onInstance = makeWorkflowTarget({ id: 'wt-on', targetType: 'device.command', targetId: 'd1', targetCommand: 'on' })
    const offInstance = makeWorkflowTarget({ id: 'wt-off', targetType: 'device.command', targetId: 'd1', targetCommand: 'off' })
    const { nodes } = buildRoutingGraph({
      mappings: [],
      schedules: [],
      triggerActions: [],
      workflowTargets: [onInstance, offInstance],
      scenes: [],
      devices: [device],
    })

    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['target:wt-on', 'target:wt-off']))
    const onNode = nodes.find((n) => n.id === 'target:wt-on')
    const offNode = nodes.find((n) => n.id === 'target:wt-off')
    expect(onNode?.data).toMatchObject({ target: onInstance, device })
    expect(offNode?.data).toMatchObject({ target: offInstance, device })
  })

  it('fans one trigger out to several targets (N wires from one trigger)', () => {
    const schedule = makeSchedule({ id: 'j1' })
    const targets = [
      makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' }),
      makeWorkflowTarget({ id: 'wt2', targetType: 'scene.execute', targetId: 's2' }),
      makeWorkflowTarget({ id: 'wt3', targetType: 'device.command', targetId: 'd1', targetCommand: 'on' }),
    ]
    const actions = [
      makeTriggerAction({ id: 'ta1', scheduleId: 'j1', workflowTargetId: 'wt1' }),
      makeTriggerAction({ id: 'ta2', scheduleId: 'j1', workflowTargetId: 'wt2' }),
      makeTriggerAction({ id: 'ta3', scheduleId: 'j1', workflowTargetId: 'wt3' }),
    ]
    const { edges } = buildRoutingGraph({
      mappings: [],
      schedules: [schedule],
      triggerActions: actions,
      workflowTargets: targets,
      scenes: [makeScene({ id: 's1' }), makeScene({ id: 's2' })],
      devices: [makeDevice({ id: 'd1' })],
    })

    const fromSchedule = edges.filter((e) => e.source === 'schedule:j1')
    expect(fromSchedule).toHaveLength(3)
    expect(fromSchedule.map((e) => e.target)).toEqual(expect.arrayContaining(['target:wt1', 'target:wt2', 'target:wt3']))
  })

  it('fans multiple triggers into one target (N:1 — many inputs to the same instance)', () => {
    const mapping = makeMapping({ id: 'm1' })
    const schedule = makeSchedule({ id: 'j1' })
    const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
    const actions = [
      makeTriggerAction({ id: 'ta1', mappingId: 'm1', workflowTargetId: 'wt1' }),
      makeTriggerAction({ id: 'ta2', scheduleId: 'j1', mappingId: null, workflowTargetId: 'wt1' }),
    ]
    const { edges } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [schedule],
      triggerActions: actions,
      workflowTargets: [target],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    const toTarget = edges.filter((e) => e.target === 'target:wt1')
    expect(toTarget.map((e) => e.source)).toEqual(expect.arrayContaining(['mapping:m1', 'schedule:j1']))
  })

  it('keeps a saved trigger position instead of auto-layouting it', () => {
    const mapping = makeMapping({ id: 'm1', position: { x: 42, y: 99 } })
    const { nodes } = buildRoutingGraph({
      mappings: [mapping],
      schedules: [],
      triggerActions: [],
      workflowTargets: [],
      scenes: [],
      devices: [],
    })

    expect(nodes.find((n) => n.id === 'mapping:m1')?.position).toEqual({ x: 42, y: 99 })
  })

  it('keeps a saved target position instead of auto-layouting it', () => {
    const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1', position: { x: 7, y: 13 } })
    const { nodes } = buildRoutingGraph({
      mappings: [],
      schedules: [],
      triggerActions: [],
      workflowTargets: [target],
      scenes: [makeScene({ id: 's1' })],
      devices: [],
    })

    expect(nodes.find((n) => n.id === 'target:wt1')?.position).toEqual({ x: 7, y: 13 })
  })

  it('auto-layouts multiple unpinned triggers to distinct positions, not all stacked together', () => {
    // Regression test: dagre writes each node's computed x/y back onto the
    // exact object passed to setNode, so sharing one size object across every
    // setNode call let the last-processed node's position silently overwrite
    // what every other node's lookup also pointed to — all nodes rendered on
    // top of each other. Three separate schedule->target chains (no shared
    // targets) makes that collapse obvious: every trigger would land at the
    // same spot instead of three distinct ones.
    const schedules = [
      makeSchedule({ id: 'j1', position: null }),
      makeSchedule({ id: 'j2', position: null }),
      makeSchedule({ id: 'j3', position: null }),
    ]
    const targets = [
      makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' }),
      makeWorkflowTarget({ id: 'wt2', targetType: 'scene.execute', targetId: 's2' }),
      makeWorkflowTarget({ id: 'wt3', targetType: 'scene.execute', targetId: 's3' }),
    ]
    const triggerActions = [
      makeTriggerAction({ id: 'ta1', scheduleId: 'j1', workflowTargetId: 'wt1' }),
      makeTriggerAction({ id: 'ta2', scheduleId: 'j2', workflowTargetId: 'wt2' }),
      makeTriggerAction({ id: 'ta3', scheduleId: 'j3', workflowTargetId: 'wt3' }),
    ]
    const scenes = [makeScene({ id: 's1' }), makeScene({ id: 's2' }), makeScene({ id: 's3' })]
    const { nodes } = buildRoutingGraph({ mappings: [], schedules, triggerActions, workflowTargets: targets, scenes, devices: [] })

    const positions = ['schedule:j1', 'schedule:j2', 'schedule:j3'].map(
      (id) => nodes.find((n) => n.id === id)?.position,
    )
    const distinct = new Set(positions.map((p) => `${p?.x},${p?.y}`))
    expect(distinct.size).toBe(3)
  })

  describe('signal args (hover tooltip + inspector "available from signal")', () => {
    it('carries the owning mapping pattern\'s named params on the edge', () => {
      const mapping = makeMapping({ id: 'm1', pattern: '/dim/:level' })
      const target = makeWorkflowTarget({ id: 'wt1', targetType: 'device.command', targetId: 'd1', targetCommand: 'setLevel' })
      const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', workflowTargetId: 'wt1' })
      const { edges } = buildRoutingGraph({
        mappings: [mapping],
        schedules: [],
        triggerActions: [action],
        workflowTargets: [target],
        scenes: [],
        devices: [makeDevice({ id: 'd1' })],
      })

      expect(edges[0]?.data?.signalArgs).toEqual(['level'])
    })

    it('is empty for a schedule-owned wire — a cron fire carries no signal', () => {
      const schedule = makeSchedule({ id: 'j1' })
      const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
      const action = makeTriggerAction({ id: 'ta1', scheduleId: 'j1', mappingId: null, workflowTargetId: 'wt1' })
      const { edges } = buildRoutingGraph({
        mappings: [],
        schedules: [schedule],
        triggerActions: [action],
        workflowTargets: [target],
        scenes: [makeScene({ id: 's1' })],
        devices: [],
      })

      expect(edges[0]?.data?.signalArgs).toEqual([])
    })

    it('a target node exposes the deduped union of its incoming wires\' signal args', () => {
      const mappingA = makeMapping({ id: 'ma', pattern: '/dim/:level' })
      const mappingB = makeMapping({ id: 'mb', pattern: '/color/:level/:hue' })
      const target = makeWorkflowTarget({ id: 'wt1', targetType: 'device.command', targetId: 'd1', targetCommand: 'setLevel' })
      const actions = [
        makeTriggerAction({ id: 'ta1', mappingId: 'ma', workflowTargetId: 'wt1' }),
        makeTriggerAction({ id: 'ta2', mappingId: 'mb', workflowTargetId: 'wt1' }),
      ]
      const { nodes } = buildRoutingGraph({
        mappings: [mappingA, mappingB],
        schedules: [],
        triggerActions: actions,
        workflowTargets: [target],
        scenes: [],
        devices: [makeDevice({ id: 'd1' })],
      })

      const data = nodes.find((n) => n.id === 'target:wt1')?.data
      expect(data?.kind).toBe('target')
      expect(data && 'availableArgs' in data ? [...data.availableArgs].sort() : []).toEqual(['hue', 'level'])
    })

    it('hasSignalWire is true once any incoming wire is mapping-owned, even with no named params', () => {
      const mapping = makeMapping({ id: 'm1', pattern: '/scene/go' })
      const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
      const action = makeTriggerAction({ id: 'ta1', mappingId: 'm1', workflowTargetId: 'wt1' })
      const { nodes } = buildRoutingGraph({
        mappings: [mapping],
        schedules: [],
        triggerActions: [action],
        workflowTargets: [target],
        scenes: [makeScene({ id: 's1' })],
        devices: [],
      })

      const data = nodes.find((n) => n.id === 'target:wt1')?.data
      expect(data?.kind === 'target' && data.availableArgs).toEqual([])
      expect(data?.kind === 'target' && data.hasSignalWire).toBe(true)
    })

    it('hasSignalWire is false when every incoming wire is schedule-owned', () => {
      const schedule = makeSchedule({ id: 'j1' })
      const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
      const action = makeTriggerAction({ id: 'ta1', scheduleId: 'j1', mappingId: null, workflowTargetId: 'wt1' })
      const { nodes } = buildRoutingGraph({
        mappings: [],
        schedules: [schedule],
        triggerActions: [action],
        workflowTargets: [target],
        scenes: [makeScene({ id: 's1' })],
        devices: [],
      })

      const data = nodes.find((n) => n.id === 'target:wt1')?.data
      expect(data?.kind === 'target' && data.hasSignalWire).toBe(false)
    })

    it('hasSignalWire is false for an unwired target — an empty union, not a crash', () => {
      const target = makeWorkflowTarget({ id: 'wt1', targetType: 'scene.execute', targetId: 's1' })
      const { nodes } = buildRoutingGraph({
        mappings: [],
        schedules: [],
        triggerActions: [],
        workflowTargets: [target],
        scenes: [makeScene({ id: 's1' })],
        devices: [],
      })

      const data = nodes.find((n) => n.id === 'target:wt1')?.data
      expect(data?.kind === 'target' && data.hasSignalWire).toBe(false)
      expect(data?.kind === 'target' && data.availableArgs).toEqual([])
    })
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

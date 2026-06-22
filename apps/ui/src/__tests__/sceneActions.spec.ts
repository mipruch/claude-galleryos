import { describe, expect, it } from 'vitest'
import type { JsonSchema } from '@gallery/driver-core'
import type { SceneActionDTO } from '@gallery/types'
import { emptyAction, isActionComplete, toActionInput, toEditAction } from '@/lib/sceneActions'

const levelSchema: JsonSchema = {
  type: 'object',
  required: ['level'],
  properties: { level: { type: 'number', minimum: 0, maximum: 1 } },
}

function makeServerAction(over: Partial<SceneActionDTO> = {}): SceneActionDTO {
  return {
    id: 'a1',
    sceneId: 's1',
    deviceId: 'd1',
    childSceneId: null,
    command: 'setLevel',
    params: { level: 0.5 },
    stepOrder: 0,
    parallelGroup: 0,
    delayMs: 0,
    onFailure: 'continue',
    ...over,
  } as SceneActionDTO
}

describe('toEditAction', () => {
  it('maps a device action and shows a zeroed delay/group as blank', () => {
    const a = toEditAction(makeServerAction())
    expect(a.target).toBe('device')
    expect(a.deviceId).toBe('d1')
    expect(a.command).toBe('setLevel')
    expect(a.params).toEqual({ level: 0.5 })
    expect(a.delayMs).toBe('')
    expect(a.parallelGroup).toBe('')
  })

  it('detects a sub-scene action by childSceneId', () => {
    const a = toEditAction(makeServerAction({ deviceId: null, command: null, childSceneId: 'child', params: {} }))
    expect(a.target).toBe('scene')
    expect(a.childSceneId).toBe('child')
  })

  it('stringifies non-zero delay/group', () => {
    const a = toEditAction(makeServerAction({ delayMs: 500, parallelGroup: 2 }))
    expect(a.delayMs).toBe('500')
    expect(a.parallelGroup).toBe('2')
  })
})

describe('isActionComplete', () => {
  it('requires device + command for a device action', () => {
    expect(isActionComplete({ ...emptyAction(), deviceId: 'd1' })).toBe(false)
    expect(isActionComplete({ ...emptyAction(), deviceId: 'd1', command: 'on' })).toBe(true)
  })

  it('requires a scene for a sub-scene action', () => {
    expect(isActionComplete({ ...emptyAction(), target: 'scene' })).toBe(false)
    expect(isActionComplete({ ...emptyAction(), target: 'scene', childSceneId: 'c1' })).toBe(true)
  })
})

describe('toActionInput', () => {
  it('coerces params to the command schema and applies the step order', () => {
    const edit = { ...emptyAction(), deviceId: 'd1', command: 'setLevel', params: { level: '0.4' }, delayMs: '300' }
    const input = toActionInput(edit, 2, levelSchema)
    expect(input).toEqual({
      deviceId: 'd1',
      command: 'setLevel',
      params: { level: 0.4 },
      stepOrder: 2,
      parallelGroup: undefined,
      delayMs: 300,
      onFailure: 'continue',
    })
  })

  it('builds a sub-scene action without device fields', () => {
    const edit = { ...emptyAction(), target: 'scene' as const, childSceneId: 'child' }
    const input = toActionInput(edit, 0, undefined)
    expect(input).toEqual({
      childSceneId: 'child',
      stepOrder: 0,
      parallelGroup: undefined,
      delayMs: undefined,
      onFailure: 'continue',
    })
  })
})

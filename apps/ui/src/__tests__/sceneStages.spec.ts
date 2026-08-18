import { describe, expect, it } from 'vitest'
import { emptyAction, isActionComplete, type EditAction } from '@/lib/sceneActions'
import {
  estimateRunTimeMs,
  flattenStages,
  groupIntoStages,
  incompleteStepCount,
  nonEmptyStageCount,
  totalSteps,
} from '@/lib/sceneStages'

function action(over: Partial<EditAction> = {}): EditAction {
  return { ...emptyAction(), deviceId: 'd1', command: 'on', ...over }
}

describe('groupIntoStages', () => {
  it('gives a fresh scene one empty starting stage', () => {
    expect(groupIntoStages([])).toEqual([[]])
  })

  it('groups actions by parallelGroup, ascending, preserving order within a column', () => {
    const a = action({ key: 'a', parallelGroup: '1' })
    const b = action({ key: 'b', parallelGroup: '0' })
    const c = action({ key: 'c', parallelGroup: '1' })
    expect(groupIntoStages([a, b, c])).toEqual([[b], [a, c]])
  })

  it('treats a blank parallelGroup as 0', () => {
    const a = action({ key: 'a', parallelGroup: '' })
    expect(groupIntoStages([a])).toEqual([[a]])
  })
})

describe('flattenStages', () => {
  it('drops empty columns and renumbers parallelGroup to a contiguous rank', () => {
    const a = action({ key: 'a' })
    const b = action({ key: 'b' })
    const flattened = flattenStages([[a], [], [b]])
    expect(flattened).toEqual([
      { action: a, parallelGroup: 0 },
      { action: b, parallelGroup: 1 },
    ])
  })

  it('keeps every action within a stage, in column order', () => {
    const a = action({ key: 'a' })
    const b = action({ key: 'b' })
    expect(flattenStages([[a, b]])).toEqual([
      { action: a, parallelGroup: 0 },
      { action: b, parallelGroup: 0 },
    ])
  })
})

describe('totalSteps / nonEmptyStageCount', () => {
  it('counts steps across all stages and only non-empty columns', () => {
    const stages = [[action({ key: 'a' }), action({ key: 'b' })], [], [action({ key: 'c' })]]
    expect(totalSteps(stages)).toBe(3)
    expect(nonEmptyStageCount(stages)).toBe(2)
  })
})

describe('incompleteStepCount', () => {
  it('counts steps missing their target across every stage', () => {
    const complete = action({ key: 'a' })
    const incomplete = { ...emptyAction(), key: 'b' }
    expect(incompleteStepCount([[complete, incomplete]], isActionComplete)).toBe(1)
    expect(incompleteStepCount([[complete]], isActionComplete)).toBe(0)
  })
})

describe('estimateRunTimeMs', () => {
  it('is 0 for an empty scene', () => {
    expect(estimateRunTimeMs([[]])).toBe(0)
  })

  it('sums stages sequentially, but takes the slowest action within a stage', () => {
    const fast = action({ key: 'a', delayMs: '0' })
    const slow = action({ key: 'b', delayMs: '500' })
    const stage2 = action({ key: 'c', delayMs: '0' })
    const withParallelStage = estimateRunTimeMs([[fast, slow], [stage2]])
    const withoutSlow = estimateRunTimeMs([[fast], [stage2]])
    expect(withParallelStage).toBeGreaterThan(withoutSlow)
    expect(withParallelStage).toBe(estimateRunTimeMs([[slow], [stage2]]))
  })
})

/**
 * Stage-board model for the scene editor.
 *
 * A scene's actions are grouped into "stages" (columns) that run in order;
 * actions inside one stage run concurrently — exactly `SceneEngine.planGroups`'
 * `parallelGroup` semantics (see `packages/types/src/schema.ts`), just edited
 * here as an array-of-arrays instead of a flat list carrying a raw group
 * number. That shape is what lets the board use plain drag-and-drop between
 * columns (`vue-draggable-plus`) instead of reconciling dropped x/y
 * coordinates back into a group index, the way the old canvas editor did.
 *
 * Stages are never persisted as their own entity (no name/id/colour) — same
 * as before, `parallelGroup` is still the only column concept the server
 * knows. `flattenStages` renumbers empty gaps away on save, exactly like the
 * old canvas's "rank" step did.
 */
import type { EditAction } from './sceneActions'

export type SceneStage = EditAction[]

/** Group a scene's ordered actions into stage columns by ascending `parallelGroup`; within a column, actions keep their original array order (== last-saved `stepOrder`). A scene with no actions yet gets one empty starting stage. */
export function groupIntoStages(actions: EditAction[]): SceneStage[] {
  const groups = [...new Set(actions.map((a) => Number(a.parallelGroup) || 0))].sort((x, y) => x - y)
  if (!groups.length) return [[]]
  return groups.map((group) => actions.filter((a) => (Number(a.parallelGroup) || 0) === group))
}

export interface FlattenedStep {
  action: EditAction
  parallelGroup: number
}

/** Flatten stage columns back into a save-ready, ordered action list. Empty columns are dropped so `parallelGroup` stays a contiguous 0..N rank (a merged/emptied column never leaves a gap in what's persisted). */
export function flattenStages(stages: SceneStage[]): FlattenedStep[] {
  return stages
    .filter((stage) => stage.length > 0)
    .flatMap((stage, parallelGroup) => stage.map((action) => ({ action, parallelGroup })))
}

/** Total step count across all stages (for the "N steps in M stages" header). */
export function totalSteps(stages: SceneStage[]): number {
  return stages.reduce((sum, stage) => sum + stage.length, 0)
}

/** Count of non-empty stages (for the "N steps in M stages" header). */
export function nonEmptyStageCount(stages: SceneStage[]): number {
  return stages.filter((stage) => stage.length > 0).length
}

/** Count of steps still missing their target (device + command, or a scene) — drives the "N cards still need a command" footer notice. */
export function incompleteStepCount(stages: SceneStage[], isComplete: (action: EditAction) => boolean): number {
  return stages.reduce((sum, stage) => sum + stage.filter((a) => !isComplete(a)).length, 0)
}

/** Rough per-action duration assumed for the cosmetic run-time estimate below — not a real device round-trip measurement, just enough to make parallel stages read faster than serial ones. */
const NOMINAL_ACTION_DURATION_MS = 150

/**
 * Cosmetic estimate of how long the scene takes to run: stages run in
 * sequence, so their times sum; actions within a stage run concurrently, so
 * a stage's time is its slowest action (delay + the nominal duration above).
 * Not fed back to the server — display only.
 */
export function estimateRunTimeMs(stages: SceneStage[]): number {
  return stages.reduce((total, stage) => {
    if (!stage.length) return total
    const stageDuration = Math.max(
      ...stage.map((action) => (Number(action.delayMs) || 0) + NOMINAL_ACTION_DURATION_MS),
    )
    return total + stageDuration
  }, 0)
}

/**
 * Scene-action editing model.
 *
 * A scene's actions are an ordered list where each step targets *either* a
 * device (`deviceId` + `command` + `params`) *or* another scene (`childSceneId`,
 * "scene composition"). The admin editor holds a flat, string-friendly
 * `EditAction` (numbers as `'' | number` so empty inputs round-trip), and this
 * module converts to/from the server shapes:
 *
 *   - `toEditAction` — server `SceneActionDTO` → editable row (for the edit flow)
 *   - `toActionInput` — editable row → `SceneActionInput` (for create/update),
 *     coercing command params against the command's `paramsSchema`.
 */
import type { CanvasPosition, OnFailure, SceneActionDTO, SceneActionInput } from '@gallery/types'
import type { JsonSchema } from '@gallery/driver-core'
import { coerceBySchema } from './schemaForm'

export type ActionTarget = 'device' | 'scene'

export interface EditAction {
  /**
   * Client-only identity, stable across reorders/re-renders — the flat form
   * never needs it (array index is enough there), but the workflow canvas
   * uses it as the Vue Flow node id since array indices shift on drag/delete.
   */
  key: string
  target: ActionTarget
  deviceId: string
  command: string
  childSceneId: string
  params: Record<string, unknown>
  /** String-backed numeric inputs ('' = unset); coerced on submit. */
  delayMs: string
  parallelGroup: string
  onFailure: OnFailure
  /** Last dropped position on the scene's workflow canvas; null/unset elsewhere. */
  position: CanvasPosition | null
}

/** A blank device action (the default when adding a step). */
export function emptyAction(): EditAction {
  return {
    key: crypto.randomUUID(),
    target: 'device',
    deviceId: '',
    command: '',
    childSceneId: '',
    params: {},
    delayMs: '',
    parallelGroup: '',
    onFailure: 'continue',
    position: null,
  }
}

/** Server action row → editable row. */
export function toEditAction(a: SceneActionDTO): EditAction {
  return {
    key: a.id,
    target: a.childSceneId ? 'scene' : 'device',
    deviceId: a.deviceId ?? '',
    command: a.command ?? '',
    childSceneId: a.childSceneId ?? '',
    params: { ...a.params },
    delayMs: a.delayMs ? String(a.delayMs) : '',
    parallelGroup: a.parallelGroup ? String(a.parallelGroup) : '',
    onFailure: a.onFailure ?? 'continue',
    position: a.position ?? null,
  }
}

/** True when an action has its required target set (device+command, or a scene). */
export function isActionComplete(a: EditAction): boolean {
  return a.target === 'device' ? !!a.deviceId && !!a.command : !!a.childSceneId
}

/**
 * Editable row → `SceneActionInput`. `stepOrder` comes from the caller (array
 * index); command params are coerced to their schema types so they satisfy the
 * server's strict param validation.
 */
/** Parse a string-backed input to a non-negative integer, or `undefined`. */
function optNonNegInt(raw: string): number | undefined {
  if (raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

export function toActionInput(
  a: EditAction,
  stepOrder: number,
  paramsSchema: JsonSchema | undefined,
): SceneActionInput {
  const common = {
    stepOrder,
    parallelGroup: optNonNegInt(a.parallelGroup),
    delayMs: optNonNegInt(a.delayMs),
    onFailure: a.onFailure,
    position: a.position,
  }
  return a.target === 'scene'
    ? { childSceneId: a.childSceneId, ...common }
    : { deviceId: a.deviceId, command: a.command, params: coerceBySchema(paramsSchema, a.params), ...common }
}

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
import type { JsonSchema } from '@gallery/driver-core'
import type { OnFailure, SceneActionDTO, SceneActionInput } from '@gallery/types'
import { coerceBySchema } from './schemaForm'

export type ActionTarget = 'device' | 'scene'

export interface EditAction {
  target: ActionTarget
  deviceId: string
  command: string
  childSceneId: string
  params: Record<string, unknown>
  /** String-backed numeric inputs ('' = unset); coerced on submit. */
  delayMs: string
  parallelGroup: string
  onFailure: OnFailure
}

/** A blank device action (the default when adding a step). */
export function emptyAction(): EditAction {
  return {
    target: 'device',
    deviceId: '',
    command: '',
    childSceneId: '',
    params: {},
    delayMs: '',
    parallelGroup: '',
    onFailure: 'continue',
  }
}

/** Server action row → editable row. */
export function toEditAction(a: SceneActionDTO): EditAction {
  return {
    target: a.childSceneId ? 'scene' : 'device',
    deviceId: a.deviceId ?? '',
    command: a.command ?? '',
    childSceneId: a.childSceneId ?? '',
    params: { ...(a.params ?? {}) },
    delayMs: a.delayMs ? String(a.delayMs) : '',
    parallelGroup: a.parallelGroup ? String(a.parallelGroup) : '',
    onFailure: a.onFailure ?? 'continue',
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
export function toActionInput(
  a: EditAction,
  stepOrder: number,
  paramsSchema: JsonSchema | undefined,
): SceneActionInput {
  const common = {
    stepOrder,
    parallelGroup: a.parallelGroup === '' ? undefined : Number(a.parallelGroup),
    delayMs: a.delayMs === '' ? undefined : Number(a.delayMs),
    onFailure: a.onFailure,
  }
  return a.target === 'scene'
    ? { childSceneId: a.childSceneId, ...common }
    : { deviceId: a.deviceId, command: a.command, params: coerceBySchema(paramsSchema, a.params), ...common }
}

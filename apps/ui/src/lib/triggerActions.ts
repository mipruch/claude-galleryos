/**
 * Trigger-action helpers shared by the workflow canvas's node components and
 * inspector. A trigger action is what a schedule or mapping fires — a scene run
 * or a single device command, 0..N per trigger. `targetId`/`targetCommand` may
 * be unset (a normal, valid "not wired yet" state); these helpers describe that
 * state rather than assuming a fully-wired row.
 */

import type { TriggerActionUpdateInput, TriggerTargetType } from '@gallery/types'

/** Selectable target types, with display labels. */
export const TARGET_TYPE_OPTIONS: ReadonlyArray<{ value: TriggerTargetType; label: string }> = [
  { value: 'scene.execute', label: 'Run scene' },
  { value: 'device.command', label: 'Device command' },
]

export const targetTypeLabel = (t: string): string =>
  TARGET_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t

/**
 * A one-line, human description of what a trigger action does — the resolved
 * scene/device names are passed in (the store knows them), keeping this pure.
 */
export function targetSummary(
  targetType: string,
  names: { sceneName?: string; deviceName?: string; command?: string | null },
): string {
  if (targetType === 'scene.execute') {
    return names.sceneName ? `Run “${names.sceneName}”` : 'Not wired yet'
  }
  if (targetType === 'device.command') {
    if (!names.deviceName) return 'Not wired yet'
    return names.command ? `${names.deviceName} · ${names.command}` : `${names.deviceName} · pick a command`
  }
  return targetTypeLabel(targetType)
}

/**
 * Resolve a trigger action's target names from the scenes/devices stores
 * already know — the shared shape `targetSummary` and the node/list-view
 * summaries all build from, so a scene/device rename only needs updating here.
 */
export function resolveTargetNames(
  action: { targetType: string; targetId: string | null; targetCommand: string | null },
  scenes: ReadonlyArray<{ id: string; name: string }>,
  devices: ReadonlyArray<{ id: string; name: string }>,
): { sceneName?: string; deviceName?: string; command: string | null } {
  return {
    sceneName: action.targetId ? scenes.find((s) => s.id === action.targetId)?.name : undefined,
    deviceName: action.targetId ? devices.find((d) => d.id === action.targetId)?.name : undefined,
    command: action.targetCommand,
  }
}

/** Whether a target type's params come from the firing signal's captured tokens (mapping-owned) or are literal (schedule-owned). */
export const usesParams = (targetType: string | undefined): boolean => targetType === 'device.command'

/** Pretty-print a params object for the textarea (empty → "{}"). */
export function stringifyParams(params: Record<string, unknown> | undefined): string {
  if (!params || Object.keys(params).length === 0) return '{}'
  return JSON.stringify(params, null, 2)
}

/** Result of parsing the params textarea. */
export type ParsedParams = { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

/**
 * Parse the params textarea: blank → `{}`, otherwise it must be a JSON object
 * (not an array or primitive).
 */
export function parseParams(text: string): ParsedParams {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Not valid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Must be a JSON object, e.g. {"level":"{:level}"}' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/** True when the text is blank or a valid JSON object (for form validation). */
export const isValidParams = (text: string): boolean => parseParams(text).ok

/** The inspector form's raw field values (all strings — Select/Input/Textarea bindings). */
export interface TriggerActionFormValues {
  targetType: TriggerTargetType
  targetId: string
  targetCommand: string
  params: string
}

/**
 * Build the update patch from the inspector form's submitted values. A blank
 * `targetId`/`targetCommand` persists as `null` (unwired, still valid); params
 * only apply to device.command and default to `{}` on an invalid/blank textarea.
 */
export function buildTriggerActionPatch(v: TriggerActionFormValues): TriggerActionUpdateInput {
  const isDeviceCommand = v.targetType === 'device.command'
  const parsed = isDeviceCommand ? parseParams(v.params) : null
  return {
    targetType: v.targetType,
    targetId: v.targetId || null,
    targetCommand: isDeviceCommand ? v.targetCommand || null : null,
    params: parsed?.ok ? parsed.value : {},
  }
}

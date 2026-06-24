/**
 * Input-mapping helpers shared by the admin list, form, and test panel.
 *
 * A mapping routes an incoming signal (OSC/TCP/HTTP) to an action. These are the
 * pure bits the views lean on: the protocol / target-type option lists and
 * labels, a human summary of a rule's target, and parse/format for the
 * `paramsTemplate` JSON the form edits as text.
 */

import type { InputProtocol, InputTargetType } from '@gallery/types'

/** Selectable protocols, with display labels. */
export const PROTOCOL_OPTIONS: ReadonlyArray<{ value: InputProtocol; label: string }> = [
  { value: 'osc', label: 'OSC' },
  { value: 'tcp', label: 'TCP' },
  { value: 'http', label: 'HTTP' },
]

/** Selectable target types, with display labels. */
export const TARGET_TYPE_OPTIONS: ReadonlyArray<{ value: InputTargetType; label: string }> = [
  { value: 'scene.execute', label: 'Run scene' },
  { value: 'device.command', label: 'Device command' },
  { value: 'event.emit', label: 'Emit event' },
]

export const protocolLabel = (p: string): string =>
  PROTOCOL_OPTIONS.find((o) => o.value === p)?.label ?? p.toUpperCase()

export const targetTypeLabel = (t: string): string =>
  TARGET_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t

/**
 * A one-line, human description of what a rule does — the resolved scene/device
 * names are passed in (the store knows them), keeping this pure.
 */
export function targetSummary(
  targetType: string,
  names: { sceneName?: string; deviceName?: string; command?: string | null },
): string {
  switch (targetType) {
    case 'scene.execute':
      return `Run “${names.sceneName ?? '—'}”`
    case 'device.command':
      return `${names.deviceName ?? '—'} · ${names.command ?? '—'}`
    case 'event.emit':
      return 'Emit event'
    default:
      return targetTypeLabel(targetType)
  }
}

/** Whether a target type needs the param-template editor (scene.execute ignores params). */
export const usesParams = (targetType: string | undefined): boolean =>
  targetType === 'device.command' || targetType === 'event.emit'

/** Pretty-print a params template object for the textarea (empty → "{}"). */
export function stringifyParamsTemplate(template: Record<string, unknown> | undefined): string {
  if (!template || Object.keys(template).length === 0) return '{}'
  return JSON.stringify(template, null, 2)
}

/** Result of parsing the params-template textarea. */
export type ParsedTemplate =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Parse the params-template textarea: blank → `{}`, otherwise it must be a JSON
 * object (not an array or primitive).
 */
export function parseParamsTemplate(text: string): ParsedTemplate {
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
export const isValidParamsTemplate = (text: string): boolean => parseParamsTemplate(text).ok

/**
 * Parse the test-panel args field: blank → `[]`, a JSON array → itself, anything
 * else → a single-element array (so a bare `0.5` or `HDMI1` just works).
 */
export function parseTestArgs(text: string): unknown[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    // Not JSON — treat the raw text as one string argument.
    return [trimmed]
  }
}

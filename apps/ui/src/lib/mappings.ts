/**
 * Input-mapping helpers shared by the admin list, canvas node, and test panel.
 *
 * A mapping is purely "when" — a protocol + address pattern; what it fires is a
 * `workflow_targets` instance wired to it via a `trigger_actions` link on the
 * workflow canvas (see `@/lib/workflowTargets`), not anything here.
 */

import type { InputProtocol } from '@gallery/types'

/** Selectable protocols, with display labels. */
export const PROTOCOL_OPTIONS: ReadonlyArray<{ value: InputProtocol; label: string }> = [
  { value: 'osc', label: 'OSC' },
  { value: 'tcp', label: 'TCP' },
  { value: 'http', label: 'HTTP' },
]

export const protocolLabel = (p: string): string =>
  PROTOCOL_OPTIONS.find((o) => o.value === p)?.label ?? p.toUpperCase()

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

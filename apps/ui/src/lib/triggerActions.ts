/**
 * Trigger-action helpers shared by the workflow canvas's node components and
 * inspector. A trigger action is what a schedule or mapping fires — a scene run
 * or a single device command, 0..N per trigger. On the edge-based canvas its
 * `targetType`/`targetId` are fixed by the wire that created it (see
 * `workflowGraph.ts`); these helpers describe that resolved target for the
 * read-only summary shown in the inspector and the Schedules monitor list.
 */

import type { TriggerTargetType } from '@gallery/types'

/** Display labels for target types — internal to `targetTypeLabel`'s unrecognized-value fallback. */
const TARGET_TYPE_OPTIONS: ReadonlyArray<{ value: TriggerTargetType; label: string }> = [
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

/** Whether a target type takes params at all — only device.command does; a scene run takes none. */
export const usesParams = (targetType: string | undefined): boolean => targetType === 'device.command'

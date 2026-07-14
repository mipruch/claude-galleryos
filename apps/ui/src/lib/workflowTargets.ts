/**
 * Workflow-target helpers shared by the workflow canvas's node components and
 * inspector. A workflow target is a placed, independently-configured instance
 * a trigger can fire — a scene run or a single device command with its params
 * (0..N instances per scene/device, e.g. separate "on"/"off" instances of the
 * same device). These helpers describe a target for the read-only summary
 * shown on its node, its inspector, and the Schedules monitor list.
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
 * A one-line, human description of what a workflow target does — the resolved
 * scene/device name is passed in (the store knows it), keeping this pure.
 */
export function targetSummary(
  targetType: string,
  names: { sceneName?: string; deviceName?: string; command?: string | null },
): string {
  if (targetType === 'scene.execute') {
    return names.sceneName ? `Run “${names.sceneName}”` : 'Unknown scene'
  }
  if (targetType === 'device.command') {
    if (!names.deviceName) return 'Unknown device'
    return names.command ? `${names.deviceName} · ${names.command}` : `${names.deviceName} · pick a command`
  }
  return targetTypeLabel(targetType)
}

/**
 * Resolve a workflow target's names from the scenes/devices stores already
 * know — the shared shape `targetSummary` and the node/list-view summaries
 * all build from, so a scene/device rename only needs updating here.
 */
export function resolveTargetNames(
  target: { targetType: string; targetId: string; targetCommand: string | null },
  scenes: ReadonlyArray<{ id: string; name: string }>,
  devices: ReadonlyArray<{ id: string; name: string }>,
): { sceneName?: string; deviceName?: string; command: string | null } {
  return {
    sceneName: target.targetType === 'scene.execute' ? scenes.find((s) => s.id === target.targetId)?.name : undefined,
    deviceName: target.targetType === 'device.command' ? devices.find((d) => d.id === target.targetId)?.name : undefined,
    command: target.targetCommand,
  }
}

/** Whether a target type takes params at all — only device.command does; a scene run takes none. */
export const usesParams = (targetType: string | undefined): boolean => targetType === 'device.command'

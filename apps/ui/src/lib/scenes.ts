/**
 * Scene domain helpers shared by the scene store, the scene bar, and the command
 * palette.
 *
 * The record *type* comes from the shared `@gallery/types` package (a `SceneDTO`
 * is the serialized `scenes` row returned by `GET /api/v1/scenes`). The DB carries
 * a free-text `icon` name; we map it to a Lucide component here so scenes render
 * with the same icon set as the device widgets (never a raw DB string/emoji). The
 * curated name→component list itself lives in `lib/icons.ts` (shared with
 * `IconPicker`, so the picker's selectable set and this resolver's known set can
 * never drift apart).
 */

import type { Component } from 'vue'
import type { RoomDTO, SceneDTO } from '@gallery/types'
import { DEFAULT_SCENE_ICON, SCENE_ICONS, normalizeIconName } from './icons'
import { ROOM_UNASSIGNED } from './devices'
import { matchesAllTerms, normalize, searchTerms } from './text'

// Re-exported under a UI-local name so components import scene types from here.
export type { SceneDTO as SceneRecord } from '@gallery/types'

export { DEFAULT_SCENE_ICON }

const ICON_BY_NAME = new Map(SCENE_ICONS.map((option) => [option.name, option.icon]))

/**
 * Map a DB `icon` name to a Lucide component from the curated set (`lib/icons.ts`).
 * Names are matched loosely (case-insensitive, ignoring a `-icon`/`lucide:` prefix,
 * and a handful of older aliases) so seed data like "lightbulb", "Power" or
 * "projector" all resolve. Unknown / missing names fall back to a generic scene
 * icon, mirroring how device widgets pick their icon.
 */
export function sceneIcon(name?: string | null): Component {
  const canonical = normalizeIconName(name)
  return (canonical && ICON_BY_NAME.get(canonical)) || DEFAULT_SCENE_ICON
}

/** A scene's room key (its `roomId`, or the shared unassigned sentinel). */
export const sceneRoomKey = (s: SceneDTO): string => s.roomId ?? ROOM_UNASSIGNED

/**
 * Keep only scenes in the selected rooms (by room key); an empty selection means
 * "all". Mirrors the device room filter, so a scene with no room maps to the same
 * "Unassigned" key as room-less devices.
 */
export function filterScenesByRooms(scenes: SceneDTO[], roomKeys: string[]): SceneDTO[] {
  if (!roomKeys.length) return scenes
  const allow = new Set(roomKeys)
  return scenes.filter((s) => allow.has(sceneRoomKey(s)))
}

/** All human-readable text a scene can be matched on, normalized. */
function sceneHaystack(scene: SceneDTO, roomName: string | undefined): string {
  return normalize([scene.name, scene.description ?? '', roomName ?? '', ...scene.tags].join(' '))
}

/**
 * Searches scenes across name, description, room, and tags.
 *
 * The search is case- and accent-insensitive. Every search term must match (AND logic).
 * An empty query returns all scenes unchanged.
 *
 * @returns The filtered array of scenes matching all search terms.
 */
export function searchScenes(scenes: SceneDTO[], query: string, rooms: RoomDTO[]): SceneDTO[] {
  const terms = searchTerms(query)
  if (!terms.length) return scenes
  const roomName = new Map(rooms.map((r) => [r.id, r.name]))
  return scenes.filter((s) =>
    matchesAllTerms(sceneHaystack(s, s.roomId ? roomName.get(s.roomId) : undefined), terms),
  )
}

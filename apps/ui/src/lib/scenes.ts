/**
 * Scene domain helpers shared by the scene store, the scene bar, and the command
 * palette.
 *
 * The record *type* comes from the shared `@gallery/types` package (a `SceneDTO`
 * is the serialized `scenes` row returned by `GET /api/v1/scenes`). The DB carries
 * a free-text `icon` name; we map it to a Lucide component here so scenes render
 * with the same icon set as the device widgets (never a raw DB string/emoji).
 */

import type { Component } from 'vue'
import {
  BlindsIcon,
  FilmIcon,
  HomeIcon,
  LightbulbIcon,
  MicIcon,
  MoonIcon,
  MusicIcon,
  PlayIcon,
  PowerIcon,
  PresentationIcon,
  ProjectorIcon,
  SparklesIcon,
  SunIcon,
  TheaterIcon,
  Volume2Icon,
  ZapIcon,
} from '@lucide/vue'
import type { RoomDTO, SceneDTO } from '@gallery/types'
import { ROOM_UNASSIGNED } from './devices'

// Re-exported under a UI-local name so components import scene types from here.
export type { SceneDTO as SceneRecord } from '@gallery/types'

/**
 * Map a DB `icon` name to a Lucide component. Names are matched loosely (case-
 * insensitive, ignoring a `-icon`/`lucide:` prefix) so seed data like "lightbulb",
 * "Power" or "projector" all resolve. Unknown / missing names fall back to a
 * generic scene icon, mirroring how device widgets pick their icon.
 */
const ICONS: Record<string, Component> = {
  play: PlayIcon,
  power: PowerIcon,
  off: PowerIcon,
  lightbulb: LightbulbIcon,
  light: LightbulbIcon,
  lights: LightbulbIcon,
  sun: SunIcon,
  day: SunIcon,
  moon: MoonIcon,
  night: MoonIcon,
  film: FilmIcon,
  movie: FilmIcon,
  cinema: FilmIcon,
  video: FilmIcon,
  projector: ProjectorIcon,
  presentation: PresentationIcon,
  lecture: PresentationIcon,
  theater: TheaterIcon,
  theatre: TheaterIcon,
  stage: TheaterIcon,
  music: MusicIcon,
  audio: Volume2Icon,
  volume: Volume2Icon,
  mic: MicIcon,
  microphone: MicIcon,
  blinds: BlindsIcon,
  curtains: BlindsIcon,
  home: HomeIcon,
  all: HomeIcon,
  zap: ZapIcon,
  sparkles: SparklesIcon,
}

/** Fallback icon for scenes with no/unknown DB icon name. */
export const DEFAULT_SCENE_ICON: Component = SparklesIcon

export function sceneIcon(name?: string | null): Component {
  if (!name) return DEFAULT_SCENE_ICON
  const key = name
    .toLowerCase()
    .replace(/^lucide:/, '')
    .replace(/-?icon$/, '')
    .trim()
  return ICONS[key] ?? DEFAULT_SCENE_ICON
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

/** Lowercase + strip diacritics, so "Sál" matches "sal". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** All human-readable text a scene can be matched on, normalized. */
function sceneHaystack(scene: SceneDTO, roomName: string | undefined): string {
  return normalize([scene.name, scene.description ?? '', roomName ?? '', ...scene.tags].join(' '))
}

/**
 * Loose, multi-field search across name, description, room and tags. Case- and
 * accent-insensitive; every whitespace-separated term must appear (AND). An empty
 * query returns the input unchanged.
 */
export function searchScenes(scenes: SceneDTO[], query: string, rooms: RoomDTO[]): SceneDTO[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return scenes
  const roomName = new Map(rooms.map((r) => [r.id, r.name]))
  return scenes.filter((s) => {
    const haystack = sceneHaystack(s, s.roomId ? roomName.get(s.roomId) : undefined)
    return terms.every((t) => haystack.includes(t))
  })
}

/**
 * The app's global icon set — the only icons a user can ever assign to a
 * scene. Free-text Lucide-name entry is deliberately not offered anywhere;
 * `IconPicker` renders exactly this curated list, and `sceneIcon()`
 * (`lib/scenes.ts`) resolves a stored DB name back to a component from the
 * same list — so the picker's selectable set and the resolver's known set can
 * never drift apart.
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

export interface SceneIconOption {
  /** Canonical DB `icon` name — stored verbatim, matched case-insensitively on read. */
  name: string
  label: string
  icon: Component
}

export const SCENE_ICONS: SceneIconOption[] = [
  { name: 'play', label: 'Play', icon: PlayIcon },
  { name: 'power', label: 'Power', icon: PowerIcon },
  { name: 'lightbulb', label: 'Light', icon: LightbulbIcon },
  { name: 'sun', label: 'Day', icon: SunIcon },
  { name: 'moon', label: 'Night', icon: MoonIcon },
  { name: 'film', label: 'Cinema', icon: FilmIcon },
  { name: 'projector', label: 'Projector', icon: ProjectorIcon },
  { name: 'presentation', label: 'Presentation', icon: PresentationIcon },
  { name: 'theater', label: 'Theatre', icon: TheaterIcon },
  { name: 'music', label: 'Music', icon: MusicIcon },
  { name: 'audio', label: 'Volume', icon: Volume2Icon },
  { name: 'mic', label: 'Microphone', icon: MicIcon },
  { name: 'blinds', label: 'Blinds', icon: BlindsIcon },
  { name: 'home', label: 'All / Home', icon: HomeIcon },
  { name: 'zap', label: 'Quick action', icon: ZapIcon },
  { name: 'sparkles', label: 'Sparkles', icon: SparklesIcon },
]

/** Fallback icon for scenes with no/unknown DB icon name. */
export const DEFAULT_SCENE_ICON: Component = SparklesIcon
export const DEFAULT_SCENE_ICON_NAME = 'sparkles'

/**
 * Aliases older/seed-data spellings to a canonical entry above, so existing
 * rows (and the loose matching `sceneIcon()` already did) keep resolving.
 */
const ALIASES: Record<string, string> = {
  off: 'power',
  light: 'lightbulb',
  lights: 'lightbulb',
  day: 'sun',
  night: 'moon',
  movie: 'film',
  cinema: 'film',
  video: 'film',
  lecture: 'presentation',
  theatre: 'theater',
  stage: 'theater',
  volume: 'audio',
  microphone: 'mic',
  curtains: 'blinds',
  all: 'home',
}

const ICON_BY_NAME = new Map(SCENE_ICONS.map((option) => [option.name, option]))

/** Normalize a raw DB `icon` string to a canonical name from `SCENE_ICONS`, or `undefined` if unknown. */
export function normalizeIconName(name?: string | null): string | undefined {
  if (!name) return undefined
  const key = name
    .toLowerCase()
    .replace(/^lucide:/, '')
    .replace(/-?icon$/, '')
    .trim()
  const canonical = ALIASES[key] ?? key
  return ICON_BY_NAME.has(canonical) ? canonical : undefined
}

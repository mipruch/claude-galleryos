import { describe, it, expect } from 'vitest'
import { SparklesIcon, LightbulbIcon, ProjectorIcon } from '@lucide/vue'
import type { RoomDTO, SceneDTO } from '@gallery/types'
import {
  DEFAULT_SCENE_ICON,
  filterScenesByRooms,
  sceneIcon,
  sceneRoomKey,
  searchScenes,
} from '@/lib/scenes'
import { ROOM_UNASSIGNED } from '@/lib/devices'
import { makeRoom, makeScene } from './fixtures'

/** Minimal scene fixture — only the fields the helpers read. */
function scene(id: string, over: Partial<SceneDTO> = {}): SceneDTO {
  return makeScene({ id, name: id, ...over })
}

function room(id: string, name: string): RoomDTO {
  return makeRoom({ id, name })
}

describe('sceneIcon', () => {
  it('maps known DB icon names (case-insensitive, tolerant of suffixes)', () => {
    expect(sceneIcon('lightbulb')).toBe(LightbulbIcon)
    expect(sceneIcon('Projector')).toBe(ProjectorIcon)
    expect(sceneIcon('lucide:lightbulb-icon')).toBe(LightbulbIcon)
  })

  it('falls back to the default icon for unknown / missing names', () => {
    expect(sceneIcon(undefined)).toBe(DEFAULT_SCENE_ICON)
    expect(sceneIcon(null)).toBe(DEFAULT_SCENE_ICON)
    expect(sceneIcon('not-a-real-icon')).toBe(SparklesIcon)
  })
})

describe('sceneRoomKey', () => {
  it('uses the roomId, or the shared unassigned sentinel', () => {
    expect(sceneRoomKey(scene('a', { roomId: 'r1' }))).toBe('r1')
    expect(sceneRoomKey(scene('b'))).toBe(ROOM_UNASSIGNED)
  })
})

describe('filterScenesByRooms', () => {
  const scenes = [
    scene('hallA', { roomId: 'r1' }),
    scene('hallB', { roomId: 'r2' }),
    scene('global'), // no room
  ]

  it('returns all scenes when no rooms are selected', () => {
    expect(filterScenesByRooms(scenes, []).map((s) => s.id)).toEqual(['hallA', 'hallB', 'global'])
  })

  it('keeps only scenes in the selected rooms', () => {
    expect(filterScenesByRooms(scenes, ['r1']).map((s) => s.id)).toEqual(['hallA'])
  })

  it('matches room-less scenes via the unassigned sentinel', () => {
    expect(filterScenesByRooms(scenes, [ROOM_UNASSIGNED]).map((s) => s.id)).toEqual(['global'])
  })
})

describe('searchScenes', () => {
  const rooms = [room('r1', 'Sál A')]
  const scenes = [
    scene('s1', { name: 'Lecture', roomId: 'r1', tags: ['video'] }),
    scene('s2', { name: 'All off', description: 'Turn everything off' }),
  ]

  it('returns the input unchanged for an empty query', () => {
    expect(searchScenes(scenes, '  ', rooms)).toHaveLength(2)
  })

  it('matches name, and is accent-insensitive on the room name', () => {
    expect(searchScenes(scenes, 'lecture', rooms).map((s) => s.id)).toEqual(['s1'])
    expect(searchScenes(scenes, 'sal a', rooms).map((s) => s.id)).toEqual(['s1'])
  })

  it('matches description and tags; AND across terms', () => {
    expect(searchScenes(scenes, 'everything', rooms).map((s) => s.id)).toEqual(['s2'])
    expect(searchScenes(scenes, 'lecture video', rooms).map((s) => s.id)).toEqual(['s1'])
    expect(searchScenes(scenes, 'lecture off', rooms)).toHaveLength(0)
  })
})

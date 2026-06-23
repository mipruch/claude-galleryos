/**
 * Typed fixture factories for UI tests.
 *
 * Tests used to build fixtures with `… as unknown as DeviceRecord/RoomDTO/SceneDTO`,
 * which silently decouples them from the real `@gallery/types` shapes — a renamed
 * or added DTO field wouldn't break a single test. These factories return the
 * *actual* DTO types with sensible defaults, so the fixtures stay coupled to the
 * wire contracts (a breaking DTO change is now a compile error in the tests).
 */
import type { DeviceDTO, IframeDTO, RoomDTO, SceneDTO, ScheduledJobDTO } from '@gallery/types'

const NOW = '2026-01-01T00:00:00.000Z'

/** A complete `DeviceDTO`; pass `over` to set only the fields a test cares about. */
export function makeDevice(over: Partial<DeviceDTO> = {}): DeviceDTO {
  return {
    id: 'd',
    connectionId: 'c',
    roomId: null,
    name: 'Device',
    description: null,
    type: 'light',
    subtype: null,
    address: {},
    capabilities: [],
    metadata: {},
    icon: null,
    displayOrder: 0,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'admin',
    ...over,
  }
}

/** A complete `RoomDTO`; pass `over` to override defaults. */
export function makeRoom(over: Partial<RoomDTO> = {}): RoomDTO {
  return {
    id: 'r',
    name: 'Room',
    description: null,
    icon: null,
    color: null,
    displayOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `ScheduledJobDTO`; pass `over` to override defaults. */
export function makeSchedule(over: Partial<ScheduledJobDTO> = {}): ScheduledJobDTO {
  return {
    id: 'j',
    name: 'Schedule',
    sceneId: 's',
    cron: '0 9 * * *',
    timezone: 'Europe/Prague',
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'admin',
    ...over,
  }
}

/** A complete `IframeDTO`; pass `over` to override defaults. */
export function makeIframe(over: Partial<IframeDTO> = {}): IframeDTO {
  return {
    id: 'i',
    name: 'Iframe',
    url: 'https://example.com/ui',
    displayOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `SceneDTO`; pass `over` to override defaults. */
export function makeScene(over: Partial<SceneDTO> = {}): SceneDTO {
  return {
    id: 's',
    roomId: null,
    name: 'Scene',
    description: null,
    icon: null,
    color: null,
    isFavorite: false,
    tags: [],
    variables: {},
    version: 1,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'admin',
    ...over,
  }
}

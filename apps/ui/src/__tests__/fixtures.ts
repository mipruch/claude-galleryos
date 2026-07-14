/**
 * Typed fixture factories for UI tests.
 *
 * Tests used to build fixtures with `… as unknown as DeviceRecord/RoomDTO/SceneDTO`,
 * which silently decouples them from the real `@gallery/types` shapes — a renamed
 * or added DTO field wouldn't break a single test. These factories return the
 * *actual* DTO types with sensible defaults, so the fixtures stay coupled to the
 * wire contracts (a breaking DTO change is now a compile error in the tests).
 */
import type {
  CameraDTO,
  DeviceDTO,
  IframeDTO,
  InputMappingDTO,
  KioskDTO,
  RoleDTO,
  RoomDTO,
  SceneDTO,
  ScheduledJobDTO,
  TriggerActionDTO,
  UserDTO,
  WorkflowTargetDTO,
} from '@gallery/types'

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
    cron: '0 9 * * *',
    timezone: 'Europe/Prague',
    enabled: true,
    position: null,
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

/** A complete `CameraDTO` (credentials already stripped); pass `over` to override. */
export function makeCamera(over: Partial<CameraDTO> = {}): CameraDTO {
  return {
    id: 'cam',
    name: 'Camera',
    url: 'rtsp://10.0.0.5:554/Streaming/Channels/101',
    displayOrder: 0,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `InputMappingDTO`; pass `over` to override defaults. */
export function makeMapping(over: Partial<InputMappingDTO> = {}): InputMappingDTO {
  return {
    id: 'm',
    name: 'Mapping',
    protocol: 'osc',
    pattern: '/scene/go',
    enabled: true,
    position: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `TriggerActionDTO` (a pure link — schedule/mapping XOR, wired to a placed workflow target); pass `over` to override defaults. */
export function makeTriggerAction(over: Partial<TriggerActionDTO> = {}): TriggerActionDTO {
  return {
    id: 'ta',
    scheduleId: null,
    mappingId: null,
    workflowTargetId: 'wt',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `WorkflowTargetDTO` (a placed, independently-configured scene/device instance); pass `over` to override defaults. */
export function makeWorkflowTarget(over: Partial<WorkflowTargetDTO> = {}): WorkflowTargetDTO {
  return {
    id: 'wt',
    targetType: 'scene.execute',
    targetId: 's',
    targetCommand: null,
    params: {},
    position: { x: 0, y: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `KioskDTO`; pass `over` to override defaults. */
export function makeKiosk(over: Partial<KioskDTO> = {}): KioskDTO {
  return {
    id: 'k',
    name: 'Kiosk',
    width: 1920,
    height: 1080,
    config: { columns: 12, cellHeight: 80, tiles: [] },
    pin: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `RoleDTO`; pass `over` to override defaults. */
export function makeRole(over: Partial<RoleDTO> = {}): RoleDTO {
  return {
    id: 'role',
    name: 'Custodian',
    isAdmin: false,
    description: null,
    deviceIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/** A complete `UserDTO`; pass `over` to override defaults. */
export function makeUser(over: Partial<UserDTO> = {}): UserDTO {
  return {
    id: 'u',
    username: 'jdoe',
    roleId: 'role',
    displayName: null,
    enabled: true,
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

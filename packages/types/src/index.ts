export type Uuid = string;

export interface Room {
  id: Uuid;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Connection {
  id: Uuid;
  name: string;
  driver_id: string;
  host: string | null;
  port: number | null;
  protocol: 'tcp' | 'udp' | 'http' | 'serial';
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type DeviceType =
  | 'lighting'
  | 'audio'
  | 'microphone'
  | 'video'
  | 'display'
  | 'matrix'
  | 'blind'
  | 'power'
  | 'custom';

export interface Device {
  id: Uuid;
  connection_id: Uuid;
  room_id: Uuid | null;
  name: string;
  description: string | null;
  type: DeviceType;
  subtype: string | null;
  address: Record<string, unknown>;
  capabilities: string[];
  metadata: Record<string, unknown>;
  icon: string | null;
  display_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SceneAction {
  id: Uuid;
  scene_id: Uuid;
  device_id: Uuid;
  step_order: number;
  parallel_group: number;
  delay_ms: number;
  command: string;
  params: Record<string, unknown>;
  on_failure: 'abort' | 'continue' | 'rollback';
  created_at: string;
}

export interface Scene {
  id: Uuid;
  room_id: Uuid | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  is_favorite: boolean;
  tags: string[];
  variables: Record<string, unknown>;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  actions?: SceneAction[];
}

export interface SceneExecution {
  id: Uuid;
  scene_id: Uuid;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';
  source: string;
  source_detail: string | null;
  pre_state: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface ScheduledJob {
  id: Uuid;
  name: string;
  scene_id: Uuid;
  cron: string;
  timezone: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface InputMapping {
  id: Uuid;
  name: string;
  protocol: 'osc' | 'tcp' | 'http';
  pattern: string;
  target_type: 'scene.execute' | 'device.command' | 'event.emit';
  target_id: Uuid | null;
  target_command: string | null;
  params_template: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type WidgetType =
  | 'scene_button'
  | 'device_slider'
  | 'device_toggle'
  | 'device_status'
  | 'room_header'
  | 'favorites_row'
  | 'spacer';

export interface UiWidget {
  id?: string;
  type: WidgetType;
  scene_id?: Uuid;
  device_id?: Uuid;
  room_id?: Uuid;
  size?: 'small' | 'medium' | 'large';
  label?: string;
}

export interface UiPage {
  id: string;
  name: string;
  icon?: string;
  widgets: UiWidget[];
}

export interface UiLayoutConfig {
  pages: UiPage[];
}

export interface UiLayout {
  id: Uuid;
  name: string;
  is_default: boolean;
  config: UiLayoutConfig;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  id: number;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  entity_type: string | null;
  entity_id: Uuid | null;
  message: string;
  metadata: Record<string, unknown>;
  duration_ms: number | null;
}

export interface DeviceStatus {
  online: boolean;
  latencyMs?: number;
  lastSeen?: string;
  lastError?: string;
}

export interface ConnectionStatus {
  online: boolean;
  latencyMs?: number;
  lastSeen?: string;
}

// WebSocket payload types
export type WsClientToServer =
  | { event: 'scene:execute'; data: { sceneId: string } }
  | { event: 'device:command'; data: { deviceId: string; command: string; params: Record<string, unknown> } }
  | { event: 'device:subscribe'; data: { deviceId: string } }
  | { event: 'device:unsubscribe'; data: { deviceId: string } };

export type WsServerToClient =
  | { event: 'device:state'; data: { deviceId: string; state: Record<string, unknown>; source: string; timestamp: string } }
  | { event: 'device:online'; data: { deviceId: string } }
  | { event: 'device:offline'; data: { deviceId: string; reason: string } }
  | { event: 'scene:started'; data: { sceneId: string; executionId: string; source: string } }
  | { event: 'scene:completed'; data: { sceneId: string; executionId: string; durationMs: number } }
  | { event: 'scene:failed'; data: { sceneId: string; executionId: string; error: string } }
  | { event: 'driver:error'; data: { connectionId: string; driverId: string; message: string } }
  | { event: 'system:alert'; data: { level: 'info' | 'warn' | 'error'; message: string } }
  | { event: 'log:entry'; data: LogEntry };

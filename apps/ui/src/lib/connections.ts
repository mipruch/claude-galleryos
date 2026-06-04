/**
 * Connection domain types + helpers shared by the store and the status widget.
 *
 * A `ConnectionRecord` is a row from `GET /api/v1/connections` (one physical
 * socket / gateway driving a DriverHost) with the live `running` flag attached.
 * Its *online* state lives separately in `ConnectionStatus`, hydrated from Redis
 * on load and kept fresh by `connection:connected` / `connection:disconnected`
 * WebSocket pushes.
 */

/** A row from `GET /api/v1/connections` (with the runtime `running` flag). */
export interface ConnectionRecord {
  id: string
  name: string
  driverId: string
  host: string | null
  port: number | null
  protocol: string | null
  enabled: boolean
  running: boolean
}

/** Online/offline + latency, from `GET /api/v1/connections/:id/status`. */
export interface ConnectionStatus {
  online: boolean
  latencyMs?: number
  lastSeen?: string
  lastError?: string
}

/**
 * The four states a connection can be in, in priority order:
 *   - `disabled`     — admin turned it off (grey)
 *   - `connected`    — socket up, healthy (green)
 *   - `reconnecting` — enabled, subprocess alive but socket down, retrying (yellow)
 *   - `disconnected` — enabled but the driver host isn't running (red)
 */
export type ConnState = 'connected' | 'reconnecting' | 'disconnected' | 'disabled'

export function connState(record: ConnectionRecord, status: ConnectionStatus | undefined): ConnState {
  if (!record.enabled) return 'disabled'
  if (status?.online) return 'connected'
  // The DriverHost auto-restarts a live connection with backoff, so an enabled
  // connection whose subprocess is still running is mid-reconnect; if it isn't
  // running at all the socket is genuinely down.
  return record.running ? 'reconnecting' : 'disconnected'
}

/** Tailwind classes for the dot/icon of each state. */
export const STATE_COLOR: Record<ConnState, string> = {
  connected: 'text-emerald-500',
  reconnecting: 'text-amber-500',
  disconnected: 'text-destructive',
  disabled: 'text-muted-foreground',
}

/** Background classes for the small status dot. */
export const STATE_DOT: Record<ConnState, string> = {
  connected: 'bg-emerald-500',
  reconnecting: 'bg-amber-500',
  disconnected: 'bg-destructive',
  disabled: 'bg-muted-foreground/50',
}

export const STATE_LABEL: Record<ConnState, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
  disabled: 'Disabled',
}

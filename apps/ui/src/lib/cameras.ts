/**
 * Camera helpers shared by the store and the live-view component.
 *
 * A camera row is one RTSP CCTV source rendered as a user-panel sidebar entry.
 * The server transcodes it to HLS on demand; the client only needs the playlist
 * URL and the stop URL. The stored `url` is an RTSP base without credentials, so
 * validation is just "is this a plausible rtsp(s):// URL".
 */

import type { CameraDTO } from '@gallery/types'

const API = '/api/v1'

/** A single camera's new display order to persist. */
export interface CameraOrderChange {
  id: string
  displayOrder: number
}

/** The HLS playlist URL the <video>/hls.js source points at for a camera. */
export function playlistUrl(cameraId: string): string {
  return `${API}/cameras/${cameraId}/stream.m3u8`
}

/** The endpoint that stops on-demand transcoding for a camera. */
export function stopUrl(cameraId: string): string {
  return `${API}/cameras/${cameraId}/stop`
}

/** True when `value` is a plausible absolute rtsp(s):// URL. */
export function isRtspUrl(value: string): boolean {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'rtsp:' || protocol === 'rtsps:'
  } catch {
    return false
  }
}

/**
 * Orders cameras by `displayOrder` (ascending), breaking ties on name so the
 * list is stable. Does not mutate the input.
 */
export function sortByDisplayOrder(list: CameraDTO[]): CameraDTO[] {
  return [...list].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  )
}

/**
 * Move camera `id` by `delta` (-1 up / +1 down) within the sorted list and
 * renumber to contiguous positions.
 *
 * @returns the new ordered list plus the minimal set whose `displayOrder`
 *   actually changed, or `null` when the move is a no-op.
 */
export function computeCameraReorder(
  cameras: CameraDTO[],
  id: string,
  delta: number,
): { order: CameraDTO[]; changed: CameraOrderChange[] } | null {
  const sorted = sortByDisplayOrder(cameras)
  const from = sorted.findIndex((c) => c.id === id)
  if (from < 0) return null
  const to = from + delta
  if (to < 0 || to >= sorted.length) return null

  const order = [...sorted]
  const [moved] = order.splice(from, 1)
  if (!moved) return null
  order.splice(to, 0, moved)

  const changed: CameraOrderChange[] = []
  order.forEach((camera, index) => {
    if (camera.displayOrder !== index) changed.push({ id: camera.id, displayOrder: index })
  })
  return { order, changed }
}

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

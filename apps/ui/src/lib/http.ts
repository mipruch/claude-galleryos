/**
 * Shared HTTP helpers for the stores: one `fetchJson` and one error reader so
 * every request surfaces the server's `ApiError.error` message (not just the
 * status text). `errMsg` normalises any thrown value to a string.
 */

import type { ApiError } from '@gallery/types'

export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Extracts an error message from an HTTP response.
 *
 * Returns the `error` field from the response body if available, otherwise falls back
 * to a string composed of the response status code and status text.
 *
 * @returns The server-provided error message, or status code and text if unavailable.
 */
async function readApiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null
  return body?.error ?? `${res.status} ${res.statusText}`
}

/**
 * Fetches and parses JSON from a URL.
 *
 * @returns The parsed JSON response as type T, or `null` for 204 No Content responses
 * @throws If the response status is not 2xx, throws an `Error` with the server's error message
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(await readApiError(res))
  if (res.status === 204) return null
  return (await res.json()) as T
}

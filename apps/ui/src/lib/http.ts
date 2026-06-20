/**
 * Shared HTTP helpers for the stores: one `fetchJson` and one error reader so
 * every request surfaces the server's `ApiError.error` message (not just the
 * status text). `errMsg` normalises any thrown value to a string.
 */

import type { ApiError } from '@gallery/types'

export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/** Read the server's `{ error, code }` body, falling back to the status line. */
async function readApiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null
  return body?.error ?? `${res.status} ${res.statusText}`
}

/** Fetch JSON, throwing the server's error message on a non-2xx response. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(await readApiError(res))
  if (res.status === 204) return null
  return (await res.json()) as T
}

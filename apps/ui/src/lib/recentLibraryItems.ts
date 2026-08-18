/**
 * "Recently used" tracking for the workflow library panel's convenience
 * shelf — small, `localStorage`-backed, and scoped to library drags only (see
 * `libraryDrag.ts`'s payload shape). Recording happens on every successful
 * drop onto the canvas (`WorkflowsView.vue`'s `onLibraryDrop`), not on drag
 * start, so a cancelled drag never counts as "used."
 */

import type { LibraryDragPayload } from './libraryDrag'

const STORAGE_KEY = 'gallery.workflow.recentLibraryItems'
const MAX_ENTRIES = 8

function readAll(): LibraryDragPayload[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is LibraryDragPayload =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as LibraryDragPayload).kind !== undefined &&
        typeof (entry as LibraryDragPayload).id === 'string',
    )
  } catch {
    return []
  }
}

/** Record a library item as just used, moving it to the front (deduped). */
export function recordRecentLibraryItem(payload: LibraryDragPayload): void {
  const deduped = readAll().filter((entry) => !(entry.kind === payload.kind && entry.id === payload.id))
  const next = [payload, ...deduped].slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable (private browsing quota, etc.) — recency is a nice-to-have, not worth failing the drop over.
  }
}

/** Recently used items of one kind, most-recent first, capped at `limit`. */
export function recentLibraryItemIds(kind: LibraryDragPayload['kind'], limit = 4): string[] {
  return readAll()
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.id)
    .slice(0, limit)
}

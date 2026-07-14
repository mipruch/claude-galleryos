/**
 * Wire format for dragging a library card (an unplaced scene/device) onto the
 * workflow routing-map canvas — shared between `LibraryPanel.vue` (drag
 * source) and `WorkflowsView.vue` (drop target) so both sides agree on the
 * payload shape without either importing the other.
 */

export interface LibraryDragPayload {
  kind: 'scene' | 'device'
  id: string
}

const MIME_TYPE = 'application/x-gallery-library-item'
const VALID_KINDS: ReadonlyArray<LibraryDragPayload['kind']> = ['scene', 'device']

/** Call from a library card's `dragstart` handler. */
export function setLibraryDragPayload(event: DragEvent, payload: LibraryDragPayload): void {
  event.dataTransfer?.setData(MIME_TYPE, JSON.stringify(payload))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function isLibraryDragPayload(value: unknown): value is LibraryDragPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<LibraryDragPayload>
  const hasValidKind = VALID_KINDS.includes(candidate.kind as LibraryDragPayload['kind'])
  return hasValidKind && typeof candidate.id === 'string'
}

/** Call from the canvas's `drop` handler. `null` if the drop didn't originate from a library card. */
export function readLibraryDragPayload(event: DragEvent): LibraryDragPayload | null {
  const raw = event.dataTransfer?.getData(MIME_TYPE)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLibraryDragPayload(parsed) ? parsed : null
  } catch {
    // Malformed payload (e.g. a drop that didn't originate from a library card) — ignore.
    return null
  }
}

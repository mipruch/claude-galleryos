/**
 * Iframe helpers shared by the admin list and form.
 *
 * An iframe row is one embedded device UI rendered as a user-panel sidebar
 * entry. The only validation that matters client-side is that the URL is a
 * real absolute `http(s)` URL (so the `<iframe>` actually loads), and that the
 * list is shown in the same ascending `displayOrder` the sidebar uses.
 */

import type { IframeDTO } from '@gallery/types'

/** A single iframe's new display order to persist. */
export interface IframeOrderChange {
  id: string
  displayOrder: number
}

/**
 * Move iframe `id` by `delta` (-1 up / +1 down) within the sorted list and
 * renumber to contiguous positions.
 *
 * @returns the new ordered list plus the minimal set whose `displayOrder`
 *   actually changed, or `null` when the move is a no-op.
 */
export function computeIframeReorder(
  iframes: IframeDTO[],
  id: string,
  delta: number,
): { order: IframeDTO[]; changed: IframeOrderChange[] } | null {
  const sorted = sortByDisplayOrder(iframes)
  const from = sorted.findIndex((f) => f.id === id)
  if (from < 0) return null
  const to = from + delta
  if (to < 0 || to >= sorted.length) return null

  const order = [...sorted]
  const [moved] = order.splice(from, 1)
  if (!moved) return null
  order.splice(to, 0, moved)

  const changed: IframeOrderChange[] = []
  order.forEach((frame, index) => {
    if (frame.displayOrder !== index) changed.push({ id: frame.id, displayOrder: index })
  })
  return { order, changed }
}

/** True when `value` is an absolute http(s) URL the browser can embed. */
export function isEmbeddableUrl(value: string): boolean {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Orders iframes by `displayOrder` (ascending), breaking ties on name so the
 * list is stable. Does not mutate the input.
 */
export function sortByDisplayOrder(list: IframeDTO[]): IframeDTO[] {
  return [...list].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  )
}

/**
 * Iframe helpers shared by the admin list and form.
 *
 * An iframe row is one embedded device UI rendered as a user-panel sidebar
 * entry. The only validation that matters client-side is that the URL is a
 * real absolute `http(s)` URL (so the `<iframe>` actually loads), and that the
 * list is shown in the same ascending `displayOrder` the sidebar uses.
 */

import type { IframeDTO } from '@gallery/types'

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

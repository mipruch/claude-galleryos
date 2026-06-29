/**
 * Kiosk helpers shared by the admin Layouts list, the Gridstack builder, and the
 * chromeless `/kiosk/:name` viewer.
 *
 * The builder uses Gridstack for the interactive grid; the viewer reproduces the
 * exact same geometry with a plain CSS grid (so Vue fully owns the live device
 * widgets, no DOM tug-of-war with Gridstack). Both read the kiosk's
 * `config.columns` / `config.cellHeight` and per-tile `x/y/w/h`, which is why
 * the placement maths lives here once.
 */

import type { KioskConfig, KioskDTO, KioskTile } from '@gallery/types'
import { normalize } from './text'

// Re-export under local names so views import everything kiosk-related from here.
export type { KioskConfig, KioskDTO, KioskTile } from '@gallery/types'

/** Gap (px) between tiles. Gridstack uses half this as per-item margin so the
 * sum across two adjacent items equals one gap — matching the viewer's CSS gap. */
export const KIOSK_GAP = 16

/** Min/max canvas dimension (px) accepted by the form + server. */
export const KIOSK_MIN_SIZE = 1
export const KIOSK_MAX_SIZE = 20000

/** True when `n` is a whole pixel size within the allowed canvas bounds. */
export function isValidCanvasSize(n: number): boolean {
  return Number.isInteger(n) && n >= KIOSK_MIN_SIZE && n <= KIOSK_MAX_SIZE
}

/**
 * Find a kiosk by its (URL) name. The match is case- and accent-insensitive and
 * trims surrounding whitespace, so `/kiosk/main%20hall` resolves "Main Hall".
 *
 * @returns the matching kiosk, or `undefined`.
 */
export function findKioskByName(list: KioskDTO[], name: string): KioskDTO | undefined {
  const target = normalize(name.trim())
  return list.find((k) => normalize(k.name.trim()) === target)
}

/** Order kiosks by name (case-insensitive) for a stable list. */
export function sortKiosksByName(list: KioskDTO[]): KioskDTO[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Inline style for the viewer's grid container — a fixed-pixel canvas split into
 * `columns` equal columns and rows of `cellHeight`px, with overflow left to the
 * outer scroll area (a canvas larger than the display scrolls).
 */
export function canvasGridStyle(kiosk: KioskDTO): Record<string, string> {
  const { columns, cellHeight } = kiosk.config
  return {
    width: `${kiosk.width}px`,
    minHeight: `${kiosk.height}px`,
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gridAutoRows: `${cellHeight}px`,
    padding: `${KIOSK_GAP / 2}px`,
  }
}

/** Inline style placing one tile on the viewer's CSS grid (1-based lines). */
export function tileGridStyle(tile: KioskTile): Record<string, string> {
  return {
    gridColumn: `${tile.x + 1} / span ${tile.w}`,
    gridRow: `${tile.y + 1} / span ${tile.h}`,
    padding: `${KIOSK_GAP / 2}px`,
  }
}

/**
 * Build a fresh `KioskConfig` keeping the geometry but replacing the tiles —
 * used by the builder when serialising the current Gridstack state.
 */
export function withTiles(config: KioskConfig, tiles: KioskTile[]): KioskConfig {
  return { columns: config.columns, cellHeight: config.cellHeight, tiles }
}

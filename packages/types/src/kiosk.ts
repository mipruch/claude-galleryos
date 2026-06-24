/**
 * Kiosk (wall screen / tablet) layout contracts — shared by server and UI.
 *
 * A kiosk is a fixed-pixel canvas shown at `/kiosk/:name` (clean, chromeless).
 * The admin builds it on a Gridstack grid: each tile clones a device widget and
 * is positioned/sized in grid units. Geometry lives in the kiosk's `config`
 * JSONB so the same numbers drive both the builder (Gridstack) and the viewer
 * (a CSS grid), keeping the two pixel-identical.
 *
 * Kept in its own module (not `records.ts`) so the Drizzle `schema.ts` can type
 * the `config` column against `KioskConfig` without importing `records.ts`
 * (which would be a cycle: records derives its row types from the schema).
 */

/** One placed device widget on the grid — position + size in grid units. */
export interface KioskTile {
  /** Stable per-tile id (a device may appear in several tiles). */
  id: string;
  /** The device whose widget this tile renders. */
  deviceId: string;
  /** Column offset (0-based). */
  x: number;
  /** Row offset (0-based). */
  y: number;
  /** Width in columns. */
  w: number;
  /** Height in rows. */
  h: number;
}

/** Grid geometry + the placed tiles. Stored in `kiosks.config`. */
export interface KioskConfig {
  /** Number of grid columns the canvas is divided into. */
  columns: number;
  /** Height of one grid row, in pixels. */
  cellHeight: number;
  /** The placed device tiles. */
  tiles: KioskTile[];
}

/** Sensible starting geometry for a freshly created kiosk. */
export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  columns: 12,
  cellHeight: 80,
  tiles: [],
};

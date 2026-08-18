/**
 * The app's global colour palette — the only colours a user can ever assign to
 * a scene (and, later, a room/device: they share the same `varchar(7)` hex
 * column convention, see `packages/types/src/schema.ts`). Free-text hex entry
 * is deliberately not offered anywhere; every colour field in the UI is a
 * `ColorPicker` built from this fixed set, so stored values are always one of
 * these swatches.
 */

export interface PaletteColor {
  /** Stored hex value (matches the DB's `varchar(7)` `color` columns). */
  value: string
  /** Accessible name shown in the picker's tooltip/aria-label. */
  label: string
}

export const PALETTE_COLORS: PaletteColor[] = [
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#14B8A6', label: 'Teal' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#000000', label: 'Black' },
]

export const DEFAULT_PALETTE_COLOR = PALETTE_COLORS[0]!.value

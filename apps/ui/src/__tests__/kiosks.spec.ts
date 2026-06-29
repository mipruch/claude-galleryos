import { describe, it, expect } from 'vitest'
import {
  canvasGridStyle,
  findKioskByName,
  isValidCanvasSize,
  sortKiosksByName,
  tileGridStyle,
  withTiles,
} from '@/lib/kiosks'
import type { KioskTile } from '@/lib/kiosks'
import { makeKiosk } from './fixtures'

describe('findKioskByName', () => {
  const list = [
    makeKiosk({ id: 'a', name: 'Main Hall' }),
    makeKiosk({ id: 'b', name: 'Foyer' }),
  ]

  it('matches case- and accent-insensitively, trimming whitespace', () => {
    expect(findKioskByName(list, 'main hall')?.id).toBe('a')
    expect(findKioskByName(list, '  MAIN HALL ')?.id).toBe('a')
    expect(findKioskByName(list, 'Foyer')?.id).toBe('b')
  })

  it('returns undefined when nothing matches', () => {
    expect(findKioskByName(list, 'Nope')).toBeUndefined()
    expect(findKioskByName([], 'Main Hall')).toBeUndefined()
  })
})

describe('sortKiosksByName', () => {
  it('orders by name and does not mutate the input', () => {
    const list = [makeKiosk({ id: 'z', name: 'Zebra' }), makeKiosk({ id: 'a', name: 'Apple' })]
    const before = list.map((k) => k.id)
    expect(sortKiosksByName(list).map((k) => k.id)).toEqual(['a', 'z'])
    expect(list.map((k) => k.id)).toEqual(before)
  })
})

describe('isValidCanvasSize', () => {
  it('accepts whole pixel sizes within bounds', () => {
    for (const n of [1, 800, 1920, 20000]) expect(isValidCanvasSize(n)).toBe(true)
  })
  it('rejects zero, negatives, fractions, and out-of-range', () => {
    for (const n of [0, -10, 1.5, 20001, NaN]) expect(isValidCanvasSize(n)).toBe(false)
  })
})

describe('tileGridStyle', () => {
  it('places a tile using 1-based grid lines and spans', () => {
    const tile: KioskTile = { id: 't', deviceId: 'd', x: 2, y: 3, w: 4, h: 2 }
    expect(tileGridStyle(tile)).toEqual({
      gridColumn: '3 / span 4',
      gridRow: '4 / span 2',
    })
  })
})

describe('canvasGridStyle', () => {
  it('derives the canvas grid from width/height + config', () => {
    const style = canvasGridStyle(makeKiosk({ width: 1280, height: 720 }))
    expect(style.width).toBe('1280px')
    expect(style.minHeight).toBe('720px')
    expect(style.gridTemplateColumns).toBe('repeat(12, 1fr)')
    expect(style.gridAutoRows).toBe('80px')
  })
})

describe('withTiles', () => {
  it('keeps geometry but swaps the tiles array', () => {
    const config = { columns: 8, cellHeight: 60, tiles: [] }
    const tiles: KioskTile[] = [{ id: 't', deviceId: 'd', x: 0, y: 0, w: 1, h: 1 }]
    expect(withTiles(config, tiles)).toEqual({ columns: 8, cellHeight: 60, tiles })
  })
})

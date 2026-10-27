import { describe, expect, it } from 'vitest'
import { windowPresentation } from './window-presentation'

describe('launcher and dock presentation', () => {
  const work = { x: -1920, y: 40, width: 1920, height: 1040 }
  it('centers the independent login window on its display', () => {
    expect(windowPresentation(false, work)).toMatchObject({ bounds: { x: -1510, y: 190, width: 1100, height: 740 }, minWidth: 840 })
  })
  it('returns to the existing 430 DIP dock after connecting', () => {
    expect(windowPresentation(true, work)).toMatchObject({ bounds: { x: -430, y: 40, width: 430, height: 900 }, minWidth: 390, maxWidth: 520, maxHeight: 0 })
  })
  it('keeps either surface inside a smaller work area', () => {
    for (const connected of [true, false]) {
      const next = windowPresentation(connected, { x: 0, y: 0, width: 800, height: 600 })
      expect(next.bounds.width).toBeLessThanOrEqual(800)
      expect(next.bounds.height).toBeLessThanOrEqual(600)
      expect(next.minWidth).toBeLessThanOrEqual(next.bounds.width)
      expect(next.minHeight).toBeLessThanOrEqual(next.bounds.height)
    }
  })
})

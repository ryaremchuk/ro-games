import { describe, it, expect } from 'vitest'
import { TRAY_SIZE } from './logic'
import {
  bottomMargin,
  trayY,
  heroBaseline,
  traySlotWidth,
  plateWidth,
  slotPos,
  monsterPos,
  miniSlot,
  snapRadius,
  PANEL_CENTER_Y_CSS,
  PANEL_H_CSS,
  type LayoutMetrics,
} from './layout'

// A clean synthetic viewport (dpr 1, round numbers) so every expectation is
// exact arithmetic, not a magic constant.
const m: LayoutMetrics = { w: 1000, h: 1000, dpr: 1, bodyR: 100, growth: 1, safeInsetBottom: 0 }

describe('feed-the-monster layout geometry', () => {
  it('tray sits a proportional share up from the bottom (~81% down)', () => {
    // Fractional margin (h*0.19 = 190) dominates the safe-area floor (60).
    expect(bottomMargin(m)).toBe(190)
    expect(trayY(m)).toBe(810)
  })

  it('the safe-area + clearance floor wins on a short viewport', () => {
    // Short landscape at dpr 2 with a home indicator: the physical floor
    // (safeInset*dpr + 60*dpr) beats the tiny fractional margin (h*0.19).
    const short: LayoutMetrics = { ...m, h: 200, dpr: 2, safeInsetBottom: 40 }
    expect(bottomMargin(short)).toBe(40 * 2 + 60 * 2) // 200
    expect(trayY(short)).toBe(0)
  })

  it('the hero baseline stands a fixed fraction above the tray', () => {
    expect(heroBaseline(m)).toBe(810 - 260) // 550
  })

  it('spreads the tray row evenly across the usable width', () => {
    const slot = traySlotWidth(m)
    expect(slot).toBeCloseTo((1000 * (1 - 2 * 0.045)) / TRAY_SIZE, 6)

    const first = slotPos(m, 0)
    expect(first.x).toBeCloseTo(1000 * 0.045 + slot / 2, 6)
    expect(first.y).toBe(trayY(m))

    // Consecutive slots are exactly one slot-width apart.
    expect(slotPos(m, 1).x - first.x).toBeCloseTo(slot, 6)
    expect(slotPos(m, 3).x - slotPos(m, 2).x).toBeCloseTo(slot, 6)
  })

  it('caps the plate width so plates never dwarf the food on wide screens', () => {
    // Narrow: plate follows its slot (slot*(1-0.16)).
    expect(plateWidth(m)).toBeCloseTo(traySlotWidth(m) * (1 - 0.16), 6)
    // Very wide: the css-px cap (112 * dpr) wins.
    const wide: LayoutMetrics = { ...m, w: 6000 }
    expect(plateWidth(wide)).toBe(112) // 112 css * dpr 1
  })

  it('centers the monster and clamps its head out from under the top panel', () => {
    const p = monsterPos(m)
    expect(p.x).toBe(500)
    // Roomy vertical: the natural baseline-derived y wins over the headroom floor.
    expect(p.y).toBe(550 - 100 * 0.55) // 495

    // Big friend on a short screen: the head would ride up under the panel, so
    // the headroom floor clamps it down instead.
    const big: LayoutMetrics = { ...m, h: 500, bodyR: 200, growth: 1.4 }
    const headroom =
      (PANEL_CENTER_Y_CSS + PANEL_H_CSS / 2) * big.dpr + big.bodyR * big.growth * 1.35
    expect(monsterPos(big).y).toBe(headroom)
  })

  it('piles the fed friends into a snug overlapping cluster', () => {
    const baseY = heroBaseline(m) - 100 * 0.28 // 522
    expect(miniSlot(m, 0)).toEqual({ x: 100, y: baseY }) // center of the pile
    expect(miniSlot(m, 1)).toEqual({ x: 100 + 0.4 * 100, y: baseY + 0.03 * 100 })
    expect(miniSlot(m, 2).x).toBeLessThan(miniSlot(m, 0).x) // 3rd mirrors left
    // Beyond the five slots, extras stack a tier up (never off the same level).
    expect(miniSlot(m, 5).y).toBeLessThan(miniSlot(m, 0).y)
  })

  it('keeps a generous feed drop radius, floored for tiny friends', () => {
    // Large friend: proportional radius (bodyR*0.9*growth) wins.
    expect(snapRadius({ ...m, bodyR: 200 })).toBe(200 * 0.9)
    // Tiny friend: the css-px floor (100 * dpr) keeps the zone forgiving.
    expect(snapRadius({ ...m, bodyR: 50 })).toBe(100)
  })
})

import { describe, it, expect } from 'vitest'
import { TRAY_SIZE } from './logic'
import { FULL_SCALE } from './journey'
import {
  beltBandY,
  beltDishPos,
  beltHeight,
  beltY,
  bottomMargin,
  dishPitch,
  potPos,
  potSnapRadius,
  potWidth,
  visibleDishCount,
  trayY,
  heroBaseline,
  traySlotWidth,
  plateWidth,
  slotPos,
  monsterPos,
  miniSlot,
  snapRadius,
  visitorTapRadius,
  PANEL_CENTER_Y_CSS,
  PANEL_H_CSS,
  VISITOR_TAP_MIN_CSS,
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

/**
 * The two shapes every layout in this app must read on. Backing px = css × dpr,
 * and bodyR mirrors what the scene computes: min(min(w,h) × 0.17, 150 × dpr).
 */
const DEVICES: Array<{ name: string; metrics: LayoutMetrics }> = [
  {
    name: 'iPad 4:3 portrait',
    metrics: {
      w: 1668,
      h: 2224,
      dpr: 2,
      bodyR: Math.min(1668 * 0.17, 300),
      growth: FULL_SCALE,
      safeInsetBottom: 20,
    },
  },
  {
    name: 'iPad 4:3 landscape',
    metrics: {
      w: 2224,
      h: 1668,
      dpr: 2,
      bodyR: Math.min(1668 * 0.17, 300),
      growth: FULL_SCALE,
      safeInsetBottom: 20,
    },
  },
  {
    name: 'iPhone landscape ~2.2:1',
    metrics: {
      w: 2556,
      h: 1179,
      dpr: 3,
      bodyR: Math.min(1179 * 0.17, 450),
      growth: FULL_SCALE,
      safeInsetBottom: 21,
    },
  },
]

describe('the kitchen pot', () => {
  for (const device of DEVICES) {
    describe(device.name, () => {
      const d = device.metrics
      const pot = potPos(d)
      const w = potWidth(d)

      it('stays fully on screen', () => {
        expect(pot.x - w / 2).toBeGreaterThan(0)
        expect(pot.x + w / 2).toBeLessThanOrEqual(d.w)
        expect(pot.y).toBeGreaterThan(0)
        expect(pot.y).toBeLessThan(d.h)
      })

      it('never overlaps the friend at FULL_SCALE', () => {
        // The friend owns the centre and is WIDE when fully grown; the pot lives
        // to the right of it.
        const friend = monsterPos(d)
        const friendRight = friend.x + d.bodyR * FULL_SCALE
        expect(pot.x - w / 2, 'the pot sits under the grown friend').toBeGreaterThan(friendRight)
      })

      it('never overlaps the tray row', () => {
        // Vertical clearance: the pot's bottom must clear the top of a plate.
        const plateTop = trayY(d) - plateWidth(d) * 0.55
        expect(pot.y + w * 0.4).toBeLessThan(plateTop)
      })

      it('never overlaps the fed-friends pile bottom-left', () => {
        const pile = miniSlot(d, 3) // the slot that reaches furthest right
        expect(pot.x - w / 2).toBeGreaterThan(pile.x + d.bodyR * 0.4)
      })

      it('gives the pot a drop zone at least as forgiving as the mouth’s', () => {
        expect(potSnapRadius(d)).toBeGreaterThanOrEqual(100 * d.dpr)
      })
    })
  }

  it('scales the pot with the cast rather than pinning it in px', () => {
    const small = potWidth({ ...m, bodyR: 100 })
    const big = potWidth({ ...m, bodyR: 200 })
    expect(big).toBeGreaterThan(small)
  })

  it('pulls the pot back in on a viewport too narrow for its usual spot', () => {
    const narrow: LayoutMetrics = { ...m, w: 300, bodyR: 200 }
    const pot = potPos(narrow)
    expect(pot.x + potWidth(narrow) / 2).toBeLessThanOrEqual(narrow.w)
  })
})

describe('the conveyor belt', () => {
  for (const device of DEVICES) {
    describe(device.name, () => {
      const d = device.metrics

      it('rides the same band as the plate row', () => {
        expect(beltY(d)).toBe(trayY(d))
      })

      it('shows a sane number of dishes, derived from the viewport', () => {
        const count = visibleDishCount(d)
        expect(count).toBeGreaterThanOrEqual(4)
        expect(count).toBeLessThanOrEqual(14)
      })

      it('keeps every visible dish inside the screen and clear of the bottom strip', () => {
        const count = visibleDishCount(d)
        const pitch = dishPitch(d)
        for (let i = 0; i < count; i++) {
          const at = beltDishPos(d, i + 0.5)
          expect(at.x - pitch / 2).toBeGreaterThanOrEqual(-1)
          expect(at.x + pitch / 2).toBeLessThanOrEqual(d.w + 1)
        }
        // The belt BAND must clear the home-indicator strip, like the tray does:
        // drags that begin on the very bottom edge trigger the iOS minimize gesture.
        expect(beltBandY(d) + beltHeight(d) / 2).toBeLessThanOrEqual(
          d.h - d.safeInsetBottom * d.dpr + 1,
        )
        expect(beltBandY(d), 'the band sits at or below the dish line').toBeGreaterThanOrEqual(
          beltY(d) - beltHeight(d),
        )
      })

      it('spaces dishes exactly one pitch apart', () => {
        const pitch = dishPitch(d)
        expect(beltDishPos(d, 1.5).x - beltDishPos(d, 0.5).x).toBeCloseTo(pitch, 6)
      })
    })
  }

  it('keeps a dish the same PHYSICAL size on every device (unlike the 8-slot tray)', () => {
    // That is the whole point: an iPhone in landscape shows MORE dishes rather
    // than the same eight squeezed.
    const ipad = DEVICES[0].metrics
    const phone = DEVICES[2].metrics
    expect(dishPitch(ipad) / ipad.dpr).toBeCloseTo(dishPitch(phone) / phone.dpr, 6)
    expect(visibleDishCount(phone)).toBeGreaterThanOrEqual(visibleDishCount(ipad))
  })

  it('shrinks the pitch rather than showing two plates on a very narrow screen', () => {
    const narrow: LayoutMetrics = { ...m, w: 300 }
    expect(visibleDishCount(narrow)).toBeGreaterThanOrEqual(4)
    expect(dishPitch(narrow) * 4).toBeLessThanOrEqual(narrow.w + 1)
  })
})

describe('a visitor’s tap circle', () => {
  // The thief and the butterfly are the only targets in the game that MOVE, and
  // they are tappable from their first frame on screen — so the circle a finger
  // has to land in is held to a physical minimum on every device.
  for (const device of DEVICES) {
    it(`is at least ~2 cm across on ${device.name}`, () => {
      const css = visitorTapRadius(device.metrics) / device.metrics.dpr
      expect(css).toBeGreaterThanOrEqual(VISITOR_TAP_MIN_CSS)
      // ~52 css px to the centimetre on an iPad: a 2 cm target is ~104 css across.
      expect(css * 2).toBeGreaterThanOrEqual(104)
      // And roomier than a still food's ~100 css hit circle, because it moves.
      expect(css * 2).toBeGreaterThan(100)
    })
  }

  it('grows with the tray on a wide screen instead of staying pinned', () => {
    const wide: LayoutMetrics = { ...m, w: 4000 }
    expect(visitorTapRadius(wide)).toBeGreaterThan(visitorTapRadius(m))
    expect(visitorTapRadius(wide)).toBeCloseTo(traySlotWidth(wide) * 0.6, 6)
  })

  it('falls back to the physical floor on a narrow screen', () => {
    const narrow: LayoutMetrics = { ...m, w: 700, dpr: 2 }
    // The proportional term (0.6 of a 79.6 css slot) is below the floor there.
    expect(traySlotWidth(narrow) * 0.6).toBeLessThan(VISITOR_TAP_MIN_CSS * narrow.dpr)
    expect(visitorTapRadius(narrow)).toBe(VISITOR_TAP_MIN_CSS * narrow.dpr)
  })
})

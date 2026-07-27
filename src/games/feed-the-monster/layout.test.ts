import { describe, it, expect } from 'vitest'
import { TRAY_SIZE } from './logic'
import { FULL_SCALE, GROW_STEPS, scaleForStep } from './journey'
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
  duoMonsterPos,
  miniSlot,
  snapRadius,
  visitorTapRadius,
  recipeCells,
  recipePanel,
  recipeWidthRatio,
  panelBottom,
  RECIPE_TILE_CSS,
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
    expect(monsterPos(big).y).toBe(panelBottom(big) + big.bodyR * big.growth * 1.35)
  })

  it('piles the fed friends into a snug overlapping cluster', () => {
    const baseY = heroBaseline(m) - 100 * 0.28 // 522
    expect(miniSlot(m, 0)).toEqual({ x: 100, y: baseY }) // center of the pile
    expect(miniSlot(m, 1)).toEqual({ x: 100 + 0.4 * 100, y: baseY + 0.03 * 100 })
    expect(miniSlot(m, 2).x).toBeLessThan(miniSlot(m, 0).x) // 3rd mirrors left
    // Beyond the five slots, extras stack a tier up (never off the same level).
    expect(miniSlot(m, 5).y).toBeLessThan(miniSlot(m, 0).y)
  })

  it('stands a duo pair close enough to read as two friends together', () => {
    // The pair sits at the halved fraction of the width (0.12 each side of
    // centre) wherever there is room for it — the wide viewport this game is
    // played on. bodyR 100 × scale 1 needs only 100 of clearance, so the
    // proportional term decides.
    const left = duoMonsterPos(m, -1, 1)
    const right = duoMonsterPos(m, 1, 1)
    expect(left.x).toBeCloseTo(500 - 120, 6)
    expect(right.x).toBeCloseTo(500 + 120, 6)
    // Symmetric about centre, both on the same line, and that line is the same
    // rule the solo friend follows.
    expect(left.y).toBe(right.y)
    expect(left.x + right.x).toBeCloseTo(m.w, 6)
    expect(left.y).toBe(heroBaseline(m) - m.bodyR * 0.55)
  })

  it('never lets the two bodies collapse into one another', () => {
    // A big pair on a narrow screen: the halved fraction (0.12 × 600 = 72) is
    // less than a body radius, so the floor takes over and keeps the two
    // silhouettes apart to within a shoulder.
    const narrow: LayoutMetrics = { ...m, w: 600, bodyR: 200 }
    const scale = 1.2
    const dx = duoMonsterPos(narrow, 1, scale).x - narrow.w / 2
    expect(dx).toBeGreaterThan(narrow.w * 0.12)
    expect(dx).toBeCloseTo(200 * scale * 0.92, 6)
    // Overlap stays a shoulder, never half a friend.
    const overlap = 2 * (narrow.bodyR * scale) - 2 * dx
    expect(overlap / (2 * narrow.bodyR * scale)).toBeLessThan(0.1)
    // And a bigger pair always stands wider apart, never the same or closer.
    expect(duoMonsterPos(narrow, 1, 1.2).x).toBeGreaterThan(duoMonsterPos(narrow, 1, 0.9).x)
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

/**
 * The pot's own recipe panel — `part + part … = dish`, hanging off the pot.
 *
 * A kitchen round is the only one with TWO task panels on screen at once (the
 * friend's "bring me this" bar at the top and the pot's "cook this" panel), so this
 * sweep is about the thing that computes fine and reads badly: the second panel
 * landing on top of the first, on the friend, on the plate row, or off the screen.
 *
 * `dishMaxIngredients` tops out at 4, which is the widest equation the game can
 * ever show: 4 tiles + 3 pluses + 1 equals + 1 result on ONE line.
 */
describe('the pot’s recipe panel', () => {
  const INGREDIENTS = [2, 3, 4]
  /** The top-left chrome GameFrame draws over every game: home + level badge. */
  const CHROME_W_CSS = 12 + 56 + 12
  const CHROME_H_CSS = 12 + 56 + 10 + 56 + 12

  for (const device of DEVICES) {
    describe(device.name, () => {
      const d = device.metrics

      for (const n of INGREDIENTS) {
        describe(`${n} ingredients`, () => {
          const box = recipePanel(d, n)
          const left = box.x - box.w / 2
          const right = box.x + box.w / 2
          const top = box.y - box.h / 2
          const bottom = box.y + box.h / 2

          it('stays inside the screen and clear of the bottom safe strip', () => {
            expect(left).toBeGreaterThan(0)
            expect(right).toBeLessThanOrEqual(d.w)
            expect(top).toBeGreaterThan(0)
            expect(bottom).toBeLessThanOrEqual(d.h - d.safeInsetBottom * d.dpr)
          })

          it('never overlaps the friend’s request bar at the top', () => {
            // The friend's bar is a FIXED-height band across the top centre; the
            // recipe panel has to live entirely below it.
            expect(top).toBeGreaterThan(panelBottom(d))
          })

          it('never overlaps the friend, even at FULL_SCALE', () => {
            const friend = monsterPos(d)
            const r = d.bodyR * FULL_SCALE
            // Only a panel whose vertical span touches the friend has to clear it
            // horizontally; the friend's blob is widest at its own centre line.
            const touches = bottom > friend.y - r * 1.35 && top < friend.y + r
            if (touches) expect(left).toBeGreaterThan(friend.x + r)
          })

          it('never overlaps the fed-friends pile', () => {
            const pile = miniSlot(d, 3) // the slot that reaches furthest right
            expect(left).toBeGreaterThan(pile.x + d.bodyR * 0.45)
          })

          it('never overlaps the tray / plate row', () => {
            expect(bottom).toBeLessThan(trayY(d) - plateWidth(d) * 0.55)
          })

          it('never overlaps the top-left home + level chrome', () => {
            const clearsRight = left > CHROME_W_CSS * d.dpr
            const clearsBelow = top > CHROME_H_CSS * d.dpr
            expect(clearsRight || clearsBelow).toBe(true)
          })

          it('hugs the pot on one side of it, never through it', () => {
            const potTop = potPos(d).y - potWidth(d) * 0.4
            const potBottom = potPos(d).y + potWidth(d) * 0.4
            if (box.below) expect(top).toBeGreaterThanOrEqual(potBottom)
            else expect(bottom).toBeLessThanOrEqual(potTop)
            // And its tail points at the pot, from inside the panel's own edge.
            expect(box.tailX).toBeGreaterThan(left)
            expect(box.tailX).toBeLessThan(right)
          })

          it('keeps the whole equation legible and inside the panel', () => {
            // Legible: a picture cell no smaller than the plate markers the child
            // already reads foods off (a tray plate is ~85–110 css across).
            expect(box.tile / d.dpr).toBeGreaterThanOrEqual(36)
            expect(box.tile / d.dpr).toBeLessThanOrEqual(RECIPE_TILE_CSS)

            const cells = recipeCells(box, n)
            // 4 tiles + 3 pluses + 1 equals + 1 result = 2n+1 cells, one line.
            expect(cells).toHaveLength(2 * n + 1)
            expect(cells.filter((c) => c.kind === 'part')).toHaveLength(n)
            expect(cells.filter((c) => c.kind === 'plus')).toHaveLength(n - 1)
            expect(cells.filter((c) => c.kind === 'equals')).toHaveLength(1)
            expect(cells.filter((c) => c.kind === 'result')).toHaveLength(1)
            for (const cell of cells) {
              expect(box.x + cell.dx - cell.size / 2).toBeGreaterThanOrEqual(left)
              expect(box.x + cell.dx + cell.size / 2).toBeLessThanOrEqual(right)
            }
            // Reads left to right, in recipe order, ending on the result.
            const order = cells.map((c) => c.kind).join(' ')
            expect(order.endsWith('equals result')).toBe(true)
            expect(cells.filter((c) => c.kind === 'part').map((c) => c.index)).toEqual(
              Array.from({ length: n }, (_, i) => i),
            )
            for (let i = 1; i < cells.length; i++) {
              expect(cells[i].dx).toBeGreaterThan(cells[i - 1].dx)
            }
          })
        })
      }

      it('grows the panel with the recipe, one line at a time', () => {
        const w = INGREDIENTS.map((n) => recipePanel(d, n).w)
        expect(w[1]).toBeGreaterThan(w[0])
        expect(w[2]).toBeGreaterThan(w[1])
      })

      it('stays legible, clear of the friend and glued to the pot as the friend grows', () => {
        // The friend swells from BASE_SCALE to FULL_SCALE over its four feeds and
        // eats into the air beside the pot as it goes — the panel has to hold up at
        // every step of that, for every recipe length, not just at one size.
        const potTop = potPos(d).y - potWidth(d) * 0.4
        const potBottom = potPos(d).y + potWidth(d) * 0.4
        for (let step = 0; step <= GROW_STEPS; step++) {
          const grown: LayoutMetrics = { ...d, growth: scaleForStep(step) }
          for (const n of INGREDIENTS) {
            const box = recipePanel(grown, n)
            const where = `${n} parts at growth step ${step}`
            expect(box.tile / d.dpr, where).toBeGreaterThanOrEqual(36)
            // Glued to the pot: the panel's near edge is within a panel-height of
            // the pot's, whichever side it took.
            const clearance = box.below
              ? box.y - box.h / 2 - potBottom
              : potTop - (box.y + box.h / 2)
            expect(clearance, where).toBeGreaterThanOrEqual(0)
            expect(clearance, where).toBeLessThan(box.h)
            // Clear of the friend, of the plate row, and of the screen edges.
            const friend = monsterPos(grown)
            const r = grown.bodyR * grown.growth
            const touches =
              box.y + box.h / 2 > friend.y - r * 1.35 && box.y - box.h / 2 < friend.y + r
            if (touches) expect(box.x - box.w / 2, where).toBeGreaterThan(friend.x + r)
            expect(box.y + box.h / 2, where).toBeLessThan(trayY(d) - plateWidth(d) * 0.55)
            expect(box.x - box.w / 2, where).toBeGreaterThan(0)
            expect(box.x + box.w / 2, where).toBeLessThanOrEqual(d.w)
          }
        }
      })
    })
  }

  it('sizes the equation from the space, never from a fixed tile', () => {
    // Squeeze the width and the tile must shrink; the panel still holds the row.
    const roomy = recipePanel(m, 4)
    const tight = recipePanel({ ...m, w: 620 }, 4)
    expect(tight.tile).toBeLessThan(roomy.tile)
    expect(tight.w).toBeLessThanOrEqual(tight.tile * recipeWidthRatio(4) + 1)
    expect(tight.w).toBeLessThan(620)
  })

  it('caps the tile at the target size however much room there is', () => {
    const huge = recipePanel({ ...m, w: 6000, h: 4000 }, 2)
    expect(huge.tile).toBe(RECIPE_TILE_CSS * m.dpr)
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
  // The thief is the only target in the game that MOVES, and it is tappable from
  // its first frame on screen — so the circle a finger has to land in is held to
  // a physical minimum on every device.
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

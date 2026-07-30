import { describe, expect, it } from 'vitest'
import {
  APPROACH_MS_EASY,
  APPROACH_MS_HARD,
  MIN_TAPPABLE_MS,
  THIEF_BASE_CHANCE,
  THIEF_MAX_CHANCE,
  THIEF_MIN_GAP,
  THIEF_SKILL_MAX,
  pickTarget,
  shouldVisit,
  thiefDials,
  updateThiefSkill,
} from './thief'
import type { PlateCandidate } from './thief'
import { VISITOR_H_CSS, VISITOR_W_CSS } from './layout'
import type { Rng } from './logic'

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SKILLS = Array.from({ length: THIEF_SKILL_MAX + 1 }, (_, i) => i)

describe('the gates', () => {
  const base = { unlocked: true, roundsSinceLastVisit: 99, struggling: false, busy: false }

  it('waits for the episode that unlocks it — never for a meter value', () => {
    // The bird is variety and joy, not a prize for counting well: its gate is the
    // journey (session.THIEF_UNLOCK_EPISODE), and nothing about skill reaches here.
    expect(shouldVisit({ ...base, unlocked: false }, () => 0)).toBe(false)
    expect(shouldVisit({ ...base, unlocked: true }, () => 0)).toBe(true)
  })

  it('never lands on a struggling child', () => {
    expect(shouldVisit({ ...base, struggling: true }, () => 0)).toBe(false)
  })

  it('never two rounds in a row', () => {
    for (let gap = 0; gap < THIEF_MIN_GAP; gap++) {
      expect(shouldVisit({ ...base, roundsSinceLastVisit: gap }, () => 0)).toBe(false)
    }
    expect(shouldVisit({ ...base, roundsSinceLastVisit: THIEF_MIN_GAP }, () => 0)).toBe(true)
    // The scene's counter reads 0 on the round a bird visited and 1 on the next
    // one, so barring back-to-back visits takes a gap of 2 — pinned here because
    // the raised chance below makes an off-by-one visible as bird spam.
    expect(THIEF_MIN_GAP).toBeGreaterThanOrEqual(2)
  })

  it('is now MUCH more likely than it shipped — the cheapest variety in the game', () => {
    // A bird costs the child nothing (the food is always replaced) and pays joy
    // rather than progress, so frequency is the one dial worth being generous with.
    // The original numbers were 0.30 base / 0.50 cap.
    expect(THIEF_BASE_CHANCE).toBeGreaterThan(0.4)
    expect(THIEF_MAX_CHANCE).toBeGreaterThan(0.7)
  })

  it('stays away while another mode owns the stage', () => {
    // A commission, a moving belt or a pot already asks something new of the
    // child; a bird on top of it would be two new mechanics in one round.
    expect(shouldVisit({ ...base, busy: true }, () => 0)).toBe(false)
  })

  it('ramps with the drought and caps out around one visit in two rounds', () => {
    const rate = (gap: number): number => {
      const rng = mulberry32(gap + 7)
      let hits = 0
      const trials = 4000
      for (let i = 0; i < trials; i++) {
        if (shouldVisit({ ...base, roundsSinceLastVisit: gap }, rng)) hits++
      }
      return hits / trials
    }
    const near = rate(THIEF_MIN_GAP)
    const far = rate(THIEF_MIN_GAP + 3)
    expect(near).toBeGreaterThan(THIEF_BASE_CHANCE * 0.7)
    expect(far).toBeGreaterThan(near)
    expect(rate(THIEF_MIN_GAP + 40)).toBeLessThanOrEqual(THIEF_MAX_CHANCE + 0.03)
  })
})

describe('difficulty curves', () => {
  it('shrink the reaction window and the telegraph, monotonically', () => {
    for (let skill = 1; skill <= THIEF_SKILL_MAX; skill++) {
      const easier = thiefDials(skill - 1)
      const harder = thiefDials(skill)
      expect(harder.peckWindowMs).toBeLessThan(easier.peckWindowMs)
      expect(harder.telegraphMs).toBeLessThan(easier.telegraphMs)
    }
  })

  it('runs the design numbers at each end', () => {
    expect(thiefDials(0)).toEqual({
      approachMs: APPROACH_MS_EASY,
      peckWindowMs: 3_000,
      telegraphMs: 1_500,
    })
    expect(thiefDials(THIEF_SKILL_MAX)).toEqual({
      approachMs: APPROACH_MS_HARD,
      peckWindowMs: 1_500,
      telegraphMs: 1_000,
    })
  })

  it('makes the bird FLY faster up the ladder — the third dial', () => {
    // How fast it flies is the most legible difficulty the mechanic has: the bird
    // is tappable for the whole glide, so a shorter glide is a sharper catch.
    for (let skill = 1; skill <= THIEF_SKILL_MAX; skill++) {
      expect(thiefDials(skill).approachMs).toBeLessThan(thiefDials(skill - 1).approachMs)
    }
    expect(APPROACH_MS_HARD).toBeLessThan(APPROACH_MS_EASY)
  })

  it('never flies faster than the glide it shipped at, even at the top', () => {
    // 620 ms was the shipped glide, and on the iPad the bird was simply already
    // there: the child never got the mid-air catch the mechanic is built around.
    // Every rung of the ladder now stays well clear of that.
    const SHIPPED_MS = 620
    for (const skill of SKILLS) {
      expect(thiefDials(skill).approachMs).toBeGreaterThan(SHIPPED_MS)
    }
  })

  it('leaves a tappable window at every skill, the top of the ladder included', () => {
    for (const skill of SKILLS) {
      const dials = thiefDials(skill)
      // What the child actually gets to aim at: the glide plus the perch.
      expect(
        dials.approachMs + dials.peckWindowMs,
        `visit too quick to catch at skill ${skill}`,
      ).toBeGreaterThanOrEqual(MIN_TAPPABLE_MS)
    }
    const hardest = thiefDials(THIEF_SKILL_MAX)
    // The hardest visit in the game: 0.9 s in the air + 1.5 s on the plate. Even if
    // the child only reacts once it lands, the glide is the warning that got their
    // eyes there — which is exactly what a 620 ms glide could not do.
    expect(hardest.approachMs).toBeGreaterThanOrEqual(900)
    expect(hardest.approachMs + hardest.peckWindowMs).toBeGreaterThanOrEqual(2_400)
  })

  it('always leaves the telegraph shorter than the window it warns about', () => {
    // The warning must not eat the whole visit, or there is nothing to react to.
    for (const skill of SKILLS) {
      const dials = thiefDials(skill)
      expect(dials.telegraphMs).toBeLessThan(dials.peckWindowMs)
    }
  })

  it('clamps outside the meter range', () => {
    expect(thiefDials(-9)).toEqual(thiefDials(0))
    expect(thiefDials(99)).toEqual(thiefDials(THIEF_SKILL_MAX))
  })
})

describe('the thief meter', () => {
  it('advances on a caught thief and eases on a missed one', () => {
    expect(updateThiefSkill(3, { tapped: true })).toBe(4)
    expect(updateThiefSkill(3, { tapped: false })).toBe(2)
  })

  it('stays inside the meter range', () => {
    expect(updateThiefSkill(0, { tapped: false })).toBe(0)
    expect(updateThiefSkill(THIEF_SKILL_MAX, { tapped: true })).toBe(THIEF_SKILL_MAX)
  })

  it('a child who always catches it reaches the top; one who never does bottoms out', () => {
    let good = 0
    let bad = THIEF_SKILL_MAX
    for (let i = 0; i < 20; i++) {
      good = updateThiefSkill(good, { tapped: true })
      bad = updateThiefSkill(bad, { tapped: false })
    }
    expect(good).toBe(THIEF_SKILL_MAX)
    expect(bad).toBe(0)
  })
})

describe('which plate', () => {
  const plate = (slot: number, foodId: string, wanted: boolean): PlateCandidate => ({
    slot,
    foodId,
    wanted,
  })

  it('is null on an empty tray rather than inventing a target', () => {
    expect(pickTarget([], mulberry32(1))).toBeNull()
  })

  it('always prefers a distractor over food the child still needs', () => {
    const plates = [
      plate(0, 'apple', true),
      plate(1, 'apple', true),
      plate(2, 'banana', false),
      plate(3, 'pear', false),
    ]
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const target = pickTarget(plates, mulberry32(seed))!
      expect(target.slot, 'the thief stole work away from the child').toBeGreaterThan(1)
      expect(target.mustReplaceSame).toBe(false)
    }
  })

  it('only takes a wanted food when there is literally nothing else — and flags it', () => {
    const plates = [plate(0, 'apple', true), plate(1, 'apple', true)]
    for (const seed of [1, 2, 3, 4, 5]) {
      const target = pickTarget(plates, mulberry32(seed))!
      expect(target.foodId).toBe('apple')
      // The scene must then drop the IDENTICAL food back, or the round becomes
      // unclearable — which is the one state this game may never reach.
      expect(target.mustReplaceSame).toBe(true)
    }
  })

  it('spreads over the available distractors rather than fixating on one', () => {
    const plates = [
      plate(0, 'apple', true),
      plate(1, 'banana', false),
      plate(2, 'pear', false),
      plate(3, 'cookie', false),
      plate(4, 'grapes', false),
    ]
    const slots = new Set<number>()
    for (let seed = 1; seed <= 60; seed++) slots.add(pickTarget(plates, mulberry32(seed))!.slot)
    expect(slots.size).toBeGreaterThan(1)
    expect(slots.has(0), 'the wanted plate was never targeted').toBe(false)
  })

  it('handles a one-plate tray without going out of range', () => {
    const target = pickTarget([plate(7, 'donut', false)], () => 0.999999)!
    expect(target.slot).toBe(7)
    expect(target.foodId).toBe('donut')
  })
})

// The bird's three frames are swapped into ONE display box (thiefMode.fitVisitor
// force-fits VISITOR_W×H_CSS), so the sprites only hold still if they were cut to a
// COMMON canvas rather than trimmed per frame. Get that wrong and the bird both
// restretches and jumps every FLAP_MS — a 150 ms flicker that is easy to ship and
// hard to spot in a screenshot. The PNG IHDR is enough to pin it.
describe('the thief sprites', () => {
  const FRAMES = ['thief-fly-up', 'thief-fly-down', 'thief-perch']

  // Pulled in through Vite's asset pipeline as base64 data URIs rather than with
  // node:fs: `src` is typechecked with browser-only types on purpose (so nothing
  // in a game can reach for the filesystem), and `?inline` keeps this spec inside
  // that surface. Test-only — the game itself loads these by URL (see art.ts).
  const INLINED = import.meta.glob('./art/thief-*.png', {
    query: '?inline',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  function pngSize(name: string): { w: number; h: number } {
    const uri = INLINED[`./art/${name}.png`]
    expect(uri, `art/${name}.png is missing`).toBeTruthy()
    const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0))
    // IHDR is the first chunk: 8-byte signature, 4 length, 4 type, then w/h as BE u32.
    const u32 = (at: number) =>
      (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
    return { w: u32(16), h: u32(20) }
  }

  it('all share one canvas, so a wing swap cannot resize or shift the bird', () => {
    const sizes = FRAMES.map(pngSize)
    for (const size of sizes) expect(size).toEqual(sizes[0])
  })

  it('is authored at the aspect of the box it is drawn into, so nothing stretches', () => {
    const { w, h } = pngSize(FRAMES[0])
    expect(w / h).toBeCloseTo(VISITOR_W_CSS / VISITOR_H_CSS, 2)
  })
})

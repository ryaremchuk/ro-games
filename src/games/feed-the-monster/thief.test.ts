import { describe, expect, it } from 'vitest'
import {
  APPROACH_MS,
  BUTTERFLY_MIN_SKILL,
  MIN_TAPPABLE_MS,
  THIEF_BASE_CHANCE,
  THIEF_MAX_CHANCE,
  THIEF_MIN_GAP,
  THIEF_MIN_SKILL,
  THIEF_SKILL_MAX,
  pickTarget,
  pickVisitor,
  shouldVisit,
  thiefDials,
  updateThiefSkill,
} from './thief'
import type { PlateCandidate } from './thief'
import { SKILL_MAX } from './logic'
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
  const base = { skill: SKILL_MAX, roundsSinceLastVisit: 99, struggling: false, busy: false }

  it('needs a child fluent with the basic loop', () => {
    expect(shouldVisit({ ...base, skill: THIEF_MIN_SKILL - 1 }, () => 0)).toBe(false)
    expect(shouldVisit({ ...base, skill: THIEF_MIN_SKILL }, () => 0)).toBe(true)
  })

  it('never lands on a struggling child', () => {
    expect(shouldVisit({ ...base, struggling: true }, () => 0)).toBe(false)
  })

  it('never two rounds in a row', () => {
    for (let gap = 0; gap < THIEF_MIN_GAP; gap++) {
      expect(shouldVisit({ ...base, roundsSinceLastVisit: gap }, () => 0)).toBe(false)
    }
    expect(shouldVisit({ ...base, roundsSinceLastVisit: THIEF_MIN_GAP }, () => 0)).toBe(true)
  })

  it('stays away while another mode owns the stage', () => {
    // A duo, a commission or a moving belt already asks something new of the
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
      expect(harder.noGoRate).toBeGreaterThanOrEqual(easier.noGoRate)
    }
  })

  it('runs the design numbers at each end', () => {
    expect(thiefDials(0)).toMatchObject({
      approachMs: 1_240,
      peckWindowMs: 3_000,
      telegraphMs: 1_500,
      noGoRate: 0,
    })
    expect(thiefDials(THIEF_SKILL_MAX).peckWindowMs).toBe(1_500)
    expect(thiefDials(THIEF_SKILL_MAX).telegraphMs).toBe(1_000)
    expect(thiefDials(THIEF_SKILL_MAX).noGoRate).toBeCloseTo(0.3)
  })

  it('flies in at half the speed it shipped at, and never faster', () => {
    // 620 ms was the shipped glide, and on the iPad the bird was simply already
    // there: the child never got the mid-air catch the mechanic is built around.
    const SHIPPED_MS = 620
    expect(APPROACH_MS).toBe(2 * SHIPPED_MS)
    for (const skill of SKILLS) {
      expect(thiefDials(skill).approachMs).toBe(APPROACH_MS)
    }
  })

  it('keeps the glide the same length at every skill — difficulty rides the peck', () => {
    // The glide is the fair-warning half of a visit: shrinking it would buy
    // difficulty by making the visit less catchable rather than more demanding.
    for (let skill = 1; skill <= THIEF_SKILL_MAX; skill++) {
      expect(thiefDials(skill).approachMs).toBe(thiefDials(skill - 1).approachMs)
    }
    // …and the whole window still tightens with skill, which is where the ladder is.
    const easiest = thiefDials(0)
    const hardest = thiefDials(THIEF_SKILL_MAX)
    expect(hardest.approachMs + hardest.peckWindowMs).toBeLessThan(
      easiest.approachMs + easiest.peckWindowMs,
    )
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
    // The hardest visit in the game: 1.24 s in the air + 1.5 s on the plate. Even
    // if the child only reacts once it lands, the glide is the warning that got
    // their eyes there — which is exactly what a 620 ms glide could not do.
    expect(hardest.approachMs).toBeGreaterThanOrEqual(1_200)
    expect(hardest.approachMs + hardest.peckWindowMs).toBeGreaterThanOrEqual(2_700)
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

  it('holds the butterfly back until the child reliably catches thieves', () => {
    for (let skill = 0; skill < BUTTERFLY_MIN_SKILL; skill++) {
      expect(thiefDials(skill).noGoRate, `butterfly leaked at skill ${skill}`).toBe(0)
    }
    expect(thiefDials(BUTTERFLY_MIN_SKILL).noGoRate).toBeGreaterThan(0)
  })
})

describe('picking the visitor', () => {
  it('is always a thief before the butterfly unlocks', () => {
    for (let skill = 0; skill < BUTTERFLY_MIN_SKILL; skill++) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect(pickVisitor(skill, mulberry32(seed))).toBe('thief')
      }
    }
  })

  it('lands near the target no-go rate over many visits', () => {
    const rate = (skill: number): number => {
      const rng = mulberry32(skill + 1)
      let butterflies = 0
      const trials = 6000
      for (let i = 0; i < trials; i++) {
        if (pickVisitor(skill, rng) === 'butterfly') butterflies++
      }
      return butterflies / trials
    }
    for (const skill of [BUTTERFLY_MIN_SKILL, THIEF_SKILL_MAX]) {
      expect(rate(skill)).toBeCloseTo(thiefDials(skill).noGoRate, 1)
    }
    // ~30% at the top: the standard ratio that makes withholding genuinely hard,
    // and still leaves the majority of visits worth acting on.
    expect(rate(THIEF_SKILL_MAX)).toBeLessThan(0.4)
    expect(rate(THIEF_SKILL_MAX)).toBeGreaterThan(0.2)
  })
})

describe('the thief meter', () => {
  it('advances on the right response and eases only on a missed thief', () => {
    expect(updateThiefSkill(3, { kind: 'thief', tapped: true })).toBe(4)
    expect(updateThiefSkill(3, { kind: 'thief', tapped: false })).toBe(2)
    expect(updateThiefSkill(3, { kind: 'butterfly', tapped: false })).toBe(4)
  })

  it('never punishes a false alarm twice — tapping the butterfly only holds', () => {
    // The reward was already withheld (no giggle); deducting on top of that would
    // be punishing the same slip a second time.
    expect(updateThiefSkill(3, { kind: 'butterfly', tapped: true })).toBe(3)
  })

  it('stays inside the meter range', () => {
    expect(updateThiefSkill(0, { kind: 'thief', tapped: false })).toBe(0)
    expect(updateThiefSkill(THIEF_SKILL_MAX, { kind: 'thief', tapped: true })).toBe(THIEF_SKILL_MAX)
    expect(updateThiefSkill(THIEF_SKILL_MAX, { kind: 'butterfly', tapped: false })).toBe(
      THIEF_SKILL_MAX,
    )
  })

  it('a child who always responds correctly reaches the top; one who never does bottoms out', () => {
    let good = 0
    let bad = THIEF_SKILL_MAX
    for (let i = 0; i < 20; i++) {
      good = updateThiefSkill(good, { kind: 'thief', tapped: true })
      bad = updateThiefSkill(bad, { kind: 'thief', tapped: false })
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

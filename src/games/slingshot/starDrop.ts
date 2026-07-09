/**
 * Pure logic for the victory-star reward (a Brawl-Stars "Starr Drop" reskin).
 * No Phaser imports — deterministic given an injected RNG and unit-tested in
 * plain jsdom (see starDrop.test.ts). The overlay in StarDropOverlay.ts is pure
 * theater on top of a pre-rolled outcome; everything that decides WHAT the child
 * wins lives here.
 *
 * The reward is a bird promotion. Rarity climbs with the bird-color ladder
 * (green → blue → purple → red → gold-yellow), mirroring activeBird.ts.
 */

import type { BirdKind, Rng } from './logic'

/**
 * Rarity ladder (ascending). The index of a kind is its "tier" — the number of
 * upgrade beats the star plays before it opens on that kind.
 */
export const STAR_DROP_TIERS: readonly BirdKind[] = ['green', 'blue', 'purple', 'red', 'yellow']

/** Tier index of a bird kind on the rarity ladder (green = 0 … yellow = 4). */
export function tierIndex(kind: BirdKind): number {
  return STAR_DROP_TIERS.indexOf(kind)
}

export interface StarDropOdd {
  kind: BirdKind
  /** Relative weight; the roll normalizes, so the column need not sum to 100. */
  weight: number
}

/**
 * Reward odds, weighted toward the mid tiers so a promotion feels attainable but
 * gold stays special. Editable config — weights are normalized by the roll.
 */
export const STAR_DROP_ODDS: readonly StarDropOdd[] = [
  { kind: 'green', weight: 15 },
  { kind: 'blue', weight: 20 },
  { kind: 'purple', weight: 25 },
  { kind: 'red', weight: 20 },
  { kind: 'yellow', weight: 20 },
]

/**
 * Roll the reward bird. Cumulative-weight selection over the (normalized) odds,
 * so the weights are free to be any positive numbers. Falls back to the last
 * entry only for the FP-boundary case where `rng()` returns ~1.
 */
export function rollStarDropTarget(
  rng: Rng,
  odds: readonly StarDropOdd[] = STAR_DROP_ODDS,
): BirdKind {
  const total = odds.reduce((sum, o) => sum + Math.max(0, o.weight), 0)
  let r = rng() * total
  for (const o of odds) {
    r -= Math.max(0, o.weight)
    if (r < 0) return o.kind
  }
  return odds[odds.length - 1].kind
}

/** One tap of the star-drop sequence. The final event is always `'open'`. */
export type StarTapEvent = 'upgrade' | 'fakeout' | 'open'

/**
 * Build the per-tap script for a drop that lands on `target`. Semantics mirror
 * Brawl Stars: the star starts at tier 0 (green) and every `'upgrade'` bumps it
 * one tier, so exactly `tierIndex(target)` upgrades are needed. A `'fakeout'` is
 * a dramatic flash that fizzles — once one happens the star never upgrades
 * again, so all upgrades come FIRST, then any fakeouts, then the closing
 * `'open'`.
 *
 * Total taps are 4 or 5 (rng picks), but never fewer than `upgrades + 1` (the
 * upgrades plus the open) — so a gold target (4 upgrades) always takes 5 taps.
 */
export function buildTapScript(target: BirdKind, rng: Rng): StarTapEvent[] {
  const upgrades = tierIndex(target)
  const minTaps = upgrades + 1
  const total = Math.max(minTaps, 4 + Math.floor(rng() * 2))
  const fakeouts = total - 1 - upgrades

  const script: StarTapEvent[] = []
  for (let i = 0; i < upgrades; i++) script.push('upgrade')
  for (let i = 0; i < fakeouts; i++) script.push('fakeout')
  script.push('open')
  return script
}

/**
 * Show the star drop after clearing this level? Every 3rd cleared level in
 * normal play; NEVER in the editor (a play-test win must not hand out rewards).
 */
export function shouldShowStarDrop(level: number, editorOn: boolean): boolean {
  if (editorOn) return false
  return level > 0 && level % 3 === 0
}

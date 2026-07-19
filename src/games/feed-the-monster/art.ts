/**
 * Reskin art contract for Feed the Monster. Sprites live in `./art/*.png`,
 * sliced from AI-generated atlases (prompts: .tmp/ftm-art-prompts.md,
 * manifests: .tmp/ftm-atlas-manifest-*.json). Adding art = dropping a PNG
 * here; the glob picks it up and the scene's preload() registers it. Every
 * consumer degrades gracefully — a missing file keeps the procedural look,
 * so the game is fully playable before (and during) art integration.
 *
 * The face is NEVER baked into body art: eyes (pupil tracking, blinks) and
 * the mouth (opens as food approaches, chomps) are engine-drawn on top of a
 * blank face patch, optionally skinned by the shared `face-eye`/`face-mouth`
 * sprites. That keeps all ten friends one animated family.
 */

import { FRIENDS_PER_EPISODE } from './journey'
import type { DetailKind } from './journey'

const ART_URLS = import.meta.glob('./art/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** `art/<name>.png` → its Phaser texture key. */
export function artKey(name: string): string {
  return `ftm-art-${name}`
}

/** All shipped art as [name, url] pairs for the scene's preload(). */
export function artEntries(): Array<[string, string]> {
  return Object.entries(ART_URLS).map(([path, url]) => {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, '')
    return [name, url]
  })
}

/**
 * One friend look: which body sprite to use and where the engine-drawn face
 * lands on it. Anchor units are × bodyR relative to the monster container
 * origin (matching the procedural face recipe); tuned per friend once the
 * real art is in.
 */
export interface FriendSpec {
  /** Body sprite name (`art/<art>.png`), also the animal it resembles. */
  art: string
  /** Eye-line Y (× bodyR). */
  faceY: number
  /** Eye X offset from center (× bodyR). */
  eyeGap: number
  /** Mouth center Y (× bodyR). */
  mouthY: number
  /** Headwear anchor Y (× bodyR) — hat/crown sit here. */
  hatY: number
}

const face = { faceY: -0.32, eyeGap: 0.35, mouthY: 0.38, hatY: -1.0 }

/**
 * Index-aligned with journey.FRIEND_COLORS (same length, same cycle), so a
 * friend's sprite and its fallback/particle color always describe the same
 * character.
 */
export const FRIEND_ROSTER: readonly FriendSpec[] = [
  { art: 'friend-0-bunny', ...face },
  { art: 'friend-1-turtle', ...face },
  { art: 'friend-2-puppy', ...face },
  { art: 'friend-3-kitten', ...face },
  { art: 'friend-4-dino', ...face },
  { art: 'friend-5-fox', ...face },
  { art: 'friend-6-koala', ...face },
  { art: 'friend-7-hippo', ...face },
  { art: 'friend-8-mouse', ...face },
  { art: 'friend-9-bear', ...face },
]

/** Stable look for a friend across sessions (mirrors journey.friendColor). */
export function friendSpec(episode: number, friendIndex: number): FriendSpec {
  return FRIEND_ROSTER[(episode * FRIENDS_PER_EPISODE + friendIndex) % FRIEND_ROSTER.length]
}

/**
 * Growth details re-skinned as wearable accessories (the procedural shapes
 * stay as the fallback). Placement is in × bodyR units on the monster
 * container; `width` drives a uniform scale.
 */
export const DETAIL_ART: Record<DetailKind, { art: string; x: number; y: number; width: number }> =
  {
    horns: { art: 'acc-hat', x: 0, y: -1.02, width: 0.9 },
    ears: { art: 'acc-glasses', x: 0, y: -0.32, width: 1.2 },
    spots: { art: 'acc-scarf', x: 0, y: 0.52, width: 1.25 },
    bowtie: { art: 'acc-bowtie', x: 0, y: 0.8, width: 0.55 },
    freckles: { art: 'acc-flower', x: -0.62, y: -0.9, width: 0.5 },
    crown: { art: 'acc-crown', x: 0, y: -1.0, width: 0.62 },
  }

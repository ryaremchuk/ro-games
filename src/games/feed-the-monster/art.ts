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

// Sprites are transparent PNGs; full-bleed backgrounds are opaque JPEGs (soft
// sky gradients — JPEG avoids palette banding at a fraction of the size).
const ART_URLS = import.meta.glob('./art/*.{png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** `art/<name>.<ext>` → its Phaser texture key. */
export function artKey(name: string): string {
  return `ftm-art-${name}`
}

/** All shipped art as [name, url] pairs for the scene's preload(). */
export function artEntries(): Array<[string, string]> {
  return Object.entries(ART_URLS).map(([path, url]) => {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.(png|jpg)$/, '')
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
  /** Eye X offset from center (× bodyR) — eyes sit at ±eyeGap. */
  eyeGap: number
  /** Mouth center Y (× bodyR). */
  mouthY: number
}

/**
 * Per-friend face anchors, in body-local × bodyR units. Derived by measuring
 * the cream face-patch centroid + extent on each sliced body sprite (the body
 * is drawn at 2.3× bodyR tall, centered at y = -0.1 bodyR), so the
 * engine-drawn eyes and mouth land on the blank patch of THIS animal
 * (headwear/glasses anchor off faceY too — see buildDetail). eyeGap is clamped
 * to a close-set kawaii range; the hippo has no cream patch (cyan muzzle) so
 * its values are hand-set to the muzzle.
 *
 * Index-aligned with journey.FRIEND_COLORS (same length, same cycle), so a
 * friend's sprite and its fallback/particle color always describe the same
 * character.
 */
export const FRIEND_ROSTER: readonly FriendSpec[] = [
  { art: 'friend-0-bunny', faceY: -0.42, eyeGap: 0.34, mouthY: 0.14 },
  { art: 'friend-1-turtle', faceY: -0.5, eyeGap: 0.41, mouthY: -0.08 },
  { art: 'friend-2-puppy', faceY: -0.46, eyeGap: 0.4, mouthY: -0.05 },
  { art: 'friend-3-kitten', faceY: -0.42, eyeGap: 0.38, mouthY: -0.02 },
  { art: 'friend-4-dino', faceY: -0.48, eyeGap: 0.43, mouthY: 0.1 },
  { art: 'friend-5-fox', faceY: -0.46, eyeGap: 0.44, mouthY: 0.12 },
  { art: 'friend-6-koala', faceY: -0.4, eyeGap: 0.38, mouthY: -0.02 },
  { art: 'friend-7-hippo', faceY: -0.42, eyeGap: 0.4, mouthY: -0.04 },
  { art: 'friend-8-mouse', faceY: -0.36, eyeGap: 0.36, mouthY: 0.02 },
  { art: 'friend-9-bear', faceY: -0.48, eyeGap: 0.38, mouthY: -0.08 },
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
    horns: { art: 'acc-hat', x: 0, y: -1.02, width: 0.82 },
    ears: { art: 'acc-glasses', x: 0, y: -0.32, width: 1.2 },
    spots: { art: 'acc-scarf', x: 0, y: 0.52, width: 1.25 },
    bowtie: { art: 'acc-bowtie', x: 0, y: 0.8, width: 0.55 },
    freckles: { art: 'acc-flower', x: -0.62, y: -0.9, width: 0.5 },
    crown: { art: 'acc-crown', x: 0, y: -1.0, width: 0.62 },
  }

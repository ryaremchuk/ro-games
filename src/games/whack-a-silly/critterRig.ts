/**
 * The swappable full-body critter rig. Each critter is a single hand-picked
 * sprite (`was-animal-<id>`, a transparent full-body cartoon animal loaded in the
 * scene's preload). The rig dresses it for a spawn (golden tint + halo, or a
 * sleeper's nightcap + cool "asleep" wash) and exposes the tween/flash controls
 * the scene drives.
 *
 * `buildCritterRig` returns two containers plus `applySpawn` / `setAwake` /
 * `flashWhite` / `reset`; the scene positions `outer` (hole position + moundScale
 * + depth, never tweened) and tweens `inner` (hidden whenever the critter is
 * down). To change the art, drop new PNGs in `critters/` and update the roster in
 * logic.ts — the rig scales every sprite uniformly to a shared height.
 */
import Phaser from 'phaser'
import type { CritterSpawn } from './logic'
import { CRITTERS } from './logic'

type Px = (css: number) => number

/** Golden-critter tint (rare celebration spawn) + the cool sleeper wash. */
const GOLD = 0xffd93d
const COOL = 0xb9c6e8

/** Tallest critter (incl. ears) rises to this many css px; the rest scale by the
 *  same factor so the artist's relative sizing survives. */
const TARGET_MAX_CSS = 152
/** Sprite bottom sits this far below the rim contact line so the dirt lip/skirt
 *  occludes the feet (and any faint baked shadow). */
const BOTTOM_LOCAL = 16

export interface CritterRig {
  /** Position + moundScale + depth carrier; never tweened. */
  outer: Phaser.GameObjects.Container
  /** Tweened container; hidden (setVisible(false)) whenever the critter is down. */
  inner: Phaser.GameObjects.Container
  /** The critter sprite — the interactive/tap target (input wired by the scene). */
  head: Phaser.GameObjects.Image
  /** Golden halo (visible only for golden critters). */
  glow: Phaser.GameObjects.Image
  /** Dress the rig for a spawn (sprite, tints, nightcap, golden glow). */
  applySpawn(spawn: CritterSpawn): void
  /** Wake a sleeper: drop the nightcap + cool wash so it reads as awake. */
  setAwake(awake: boolean): void
  /** Punch a white FILL flash on the sprite for `ms`, then restore its tint. */
  flashWhite(ms: number): void
  /** Return to the hidden down pose (clear tints, hide nightcap + glow). */
  reset(): void
}

/** Uniform css-per-native scale so the tallest sprite reaches TARGET_MAX_CSS. */
function critterScale(scene: Phaser.Scene, px: Px): number {
  let maxH = 1
  for (const c of CRITTERS) {
    const frame = scene.textures.get(`was-animal-${c.id}`).getSourceImage()
    if (frame && frame.height > maxH) maxH = frame.height
  }
  return px(TARGET_MAX_CSS) / maxH
}

/** Build the sleeper nightcap texture once (idempotent). Key: `was-rig-cap`. */
function ensureRigTextures(scene: Phaser.Scene, px: Px): void {
  if (scene.textures.exists('was-rig-cap')) return
  const g = scene.add.graphics()
  const w = px(66)
  const h = px(60)
  // Drooping cone (base lower-left → tip drooped upper-right).
  g.fillStyle(0x7b93d9, 1)
  g.fillTriangle(px(8), px(46), px(44), px(42), px(60), px(12))
  // Shaded underside of the droop.
  g.fillStyle(0x6b82c8, 1)
  g.fillTriangle(px(44), px(42), px(60), px(12), px(50), px(40))
  // Fluffy white brim across the base.
  g.fillStyle(0xffffff, 1)
  g.fillEllipse(px(26), px(46), px(48), px(18))
  // Pom-pom at the tip.
  g.fillCircle(px(60), px(12), px(9))
  g.generateTexture('was-rig-cap', w, h)
  g.destroy()
}

/** Build one critter rig (outer/inner containers + sprite + nightcap + glow). */
export function buildCritterRig(scene: Phaser.Scene, px: Px): CritterRig {
  ensureRigTextures(scene, px)
  const k = critterScale(scene, px)

  // Child order (back → front): glow, sprite, nightcap.
  const glow = scene.add.image(0, px(-64), 'was-glow').setVisible(false)
  const sprite = scene.add
    .image(0, px(BOTTOM_LOCAL), `was-animal-${CRITTERS[0].id}`)
    .setOrigin(0.5, 1)
    .setScale(k)
  const cap = scene.add.image(0, 0, 'was-rig-cap').setOrigin(0.5, 1).setVisible(false)

  const inner = scene.add.container(0, 0, [glow, sprite, cap])
  const outer = scene.add.container(0, 0, [inner])
  inner.setVisible(false)

  // The whole sprite is the tap target (big rectangle = forgiving for a 3yo).
  // Wired on/off by the scene.
  sprite.setInteractive()
  sprite.disableInteractive()

  let sleepy = false
  let lastSpawn: CritterSpawn | null = null

  /** Perch the nightcap centered on the crown (its brim overlaps the sprite top,
   *  the cone rises above) — robust across every animal's head shape. */
  const placeCap = (): void => {
    const dispH = sprite.displayHeight
    const dispW = sprite.displayWidth
    const capFrame = scene.textures.get('was-rig-cap').getSourceImage()
    const capScale = (dispW * 0.52) / capFrame.width
    cap.setScale(capScale).setAngle(12)
    const spriteTop = px(BOTTOM_LOCAL) - dispH
    cap.setPosition(0, spriteTop + dispH * 0.13)
  }

  const applySpawn = (spawn: CritterSpawn): void => {
    sleepy = spawn.sleepy
    lastSpawn = spawn
    sprite.setTexture(`was-animal-${spawn.critterId}`).setScale(k)
    sprite.setTintMode(Phaser.TintModes.MULTIPLY)

    if (spawn.golden) {
      sprite.setTint(GOLD)
      glow.setVisible(true)
    } else if (sleepy) {
      sprite.setTint(COOL)
      glow.setVisible(false)
    } else {
      sprite.clearTint()
      glow.setVisible(false)
    }

    if (sleepy) {
      placeCap()
      cap.setVisible(true)
    } else {
      cap.setVisible(false)
    }
  }

  const setAwake = (awake: boolean): void => {
    // Waking a sleeper drops its nightcap + cool wash so it reads as awake.
    if (awake && sleepy) {
      cap.setVisible(false)
      sprite.clearTint()
    }
  }

  const flashWhite = (ms: number): void => {
    sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    scene.time.delayedCall(ms, () => {
      sprite.setTintMode(Phaser.TintModes.MULTIPLY)
      if (lastSpawn) applySpawn(lastSpawn)
    })
  }

  const reset = (): void => {
    inner.setScale(1).setAngle(0).setAlpha(1).setVisible(false)
    sprite.clearTint()
    sprite.setTintMode(Phaser.TintModes.MULTIPLY)
    glow.setVisible(false)
    cap.setVisible(false)
    sleepy = false
    lastSpawn = null
  }

  return { outer, inner, head: sprite, glow, applySpawn, setAwake, flashWhite, reset }
}

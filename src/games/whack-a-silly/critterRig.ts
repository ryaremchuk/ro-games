/**
 * The swappable full-body critter rig. A critter is an emoji HEAD sitting on a
 * procedurally-shaded BODY with a belly patch and two paws gripping the rim,
 * plus sleeper-only parts (closed eyes + a nightcap). All body parts are baked
 * GRAYSCALE with 3D shading and tinted per-critter (MULTIPLY) via rigStyles, so
 * one set of textures dresses every critter and the art can be re-skinned here
 * without touching the scene.
 *
 * `buildCritterRig` returns the two containers plus `applySpawn` / `setAwake` /
 * `reset`; the scene positions `outer` (hole position + moundScale + depth,
 * never tweened) and tweens `inner` (hidden whenever the critter is down). To
 * change the art later, edit `ensureRigTextures` + the child list only.
 */
import Phaser from 'phaser'
import type { CritterSpawn } from './logic'
import { rigStyleFor } from './rigStyles'

type Px = (css: number) => number

// Golden-critter tints (rare celebration spawn).
const GOLD = 0xffd93d
const GOLD_BELLY = 0xfff6c0
const GOLD_PAW = 0xe8bd2a
// Nightcap fabric + the cool wash laid over a sleeping critter.
const COOL = 0x9fb4de

export interface CritterRig {
  /** Position + moundScale + depth carrier; never tweened. */
  outer: Phaser.GameObjects.Container
  /** Tweened container; hidden (setVisible(false)) whenever the critter is down. */
  inner: Phaser.GameObjects.Container
  /** The emoji head — the interactive/tap target (input wired by the scene). */
  head: Phaser.GameObjects.Image
  /** Golden halo (visible only for golden critters). */
  glow: Phaser.GameObjects.Image
  /** Dress the rig for a spawn (textures, tints, sleeper parts, golden glow). */
  applySpawn(spawn: CritterSpawn): void
  /** Toggle a sleeper's closed-eye overlay (waking reveals the emoji's eyes). */
  setAwake(awake: boolean): void
  /** Punch a white FILL flash on all body parts for `ms`, then restore tints. */
  flashWhite(ms: number): void
  /** Return to the hidden down pose (clear tints, hide sleeper parts + glow). */
  reset(): void
}

/** Linear RGB blend of two 0xRRGGBB colors, t in [0,1]. */
function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}

/** Cool, slightly dimmed wash for a sleeping critter (reads as "asleep"). */
function coolTint(color: number): number {
  return blend(color, COOL, 0.42)
}

function ellipsePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
}

/** Build every rig texture once (idempotent). Keys are `was-rig-*`. */
function ensureRigTextures(scene: Phaser.Scene, px: Px): void {
  // Body: grayscale rounded torso with baked radial shading (highlight upper
  // left → shadow lower). Tinted per critter; MULTIPLY keeps the shading.
  if (!scene.textures.exists('was-rig-body')) {
    const w = px(84)
    const h = px(64)
    const tex = scene.textures.createCanvas('was-rig-body', w, h)
    if (tex) {
      const ctx = tex.getContext()
      const grad = ctx.createRadialGradient(
        w * 0.42,
        h * 0.32,
        w * 0.05,
        w * 0.5,
        h * 0.62,
        w * 0.72,
      )
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.5, '#cfcfcf')
      grad.addColorStop(1, '#6d6d6d')
      ctx.fillStyle = grad
      ellipsePath(ctx, w / 2, h * 0.5, w * 0.46, h * 0.48)
      ctx.fill()
      tex.refresh()
    }
  }

  // Belly: soft near-white ellipse (tinted a paler body shade).
  if (!scene.textures.exists('was-rig-belly')) {
    const w = px(46)
    const h = px(36)
    const tex = scene.textures.createCanvas('was-rig-belly', w, h)
    if (tex) {
      const ctx = tex.getContext()
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.4, w * 0.05, w * 0.5, h * 0.55, w * 0.62)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(1, '#dedede')
      ctx.fillStyle = grad
      ellipsePath(ctx, w / 2, h / 2, w * 0.48, h * 0.46)
      ctx.fill()
      tex.refresh()
    }
  }

  // Paw: grayscale rounded blob with three little toe bumps.
  if (!scene.textures.exists('was-rig-paw')) {
    const w = px(26)
    const h = px(18)
    const tex = scene.textures.createCanvas('was-rig-paw', w, h)
    if (tex) {
      const ctx = tex.getContext()
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#ededed')
      grad.addColorStop(1, '#8c8c8c')
      ctx.fillStyle = grad
      ellipsePath(ctx, w / 2, h * 0.42, w * 0.46, h * 0.4)
      ctx.fill()
      ctx.fillStyle = '#cccccc'
      for (const dx of [-0.26, 0, 0.26]) {
        ellipsePath(ctx, w * (0.5 + dx), h * 0.72, w * 0.12, h * 0.2)
        ctx.fill()
      }
      tex.refresh()
    }
  }

  // Sleeper eyes: two ∪-arcs (closed, content eyes). Drawn dark (no tint).
  if (!scene.textures.exists('was-rig-eyes')) {
    const g = scene.add.graphics()
    g.lineStyle(px(3), 0x3a2a1e, 1)
    for (const cx of [px(11), px(29)]) {
      g.beginPath()
      g.arc(cx, px(6), px(7), Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160))
      g.strokePath()
    }
    g.generateTexture('was-rig-eyes', px(40), px(18))
    g.destroy()
  }

  // Nightcap: drooping blue cone + white fluffy brim + white pom-pom.
  if (!scene.textures.exists('was-rig-cap')) {
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
}

/** Build one critter rig (outer/inner containers + all parts + controls). */
export function buildCritterRig(scene: Phaser.Scene, px: Px): CritterRig {
  ensureRigTextures(scene, px)

  // Child order (back → front): glow, body, belly, paws, head, eyes, cap.
  const glow = scene.add.image(0, px(-60), 'was-glow').setVisible(false)
  const body = scene.add.image(0, px(-30), 'was-rig-body')
  const belly = scene.add.image(0, px(-22), 'was-rig-belly')
  const pawL = scene.add.image(px(-32), 0, 'was-rig-paw')
  const pawR = scene.add.image(px(32), 0, 'was-rig-paw').setFlipX(true)
  const head = scene.add.image(0, px(-78), 'was-critter-hamster')
  const eyes = scene.add.image(0, px(-80), 'was-rig-eyes').setVisible(false)
  const cap = scene.add.image(px(6), px(-112), 'was-rig-cap').setVisible(false).setAngle(12)

  const inner = scene.add.container(0, 0, [glow, body, belly, pawL, pawR, head, eyes, cap])
  const outer = scene.add.container(0, 0, [inner])
  inner.setVisible(false)

  // Head is the tap target (~120 css circle). Wired + toggled by the scene.
  const frame = scene.textures.getFrame('was-critter-hamster')
  head.setInteractive(
    new Phaser.Geom.Circle(frame.width / 2, frame.height / 2, px(60)),
    Phaser.Geom.Circle.Contains,
  )
  head.disableInteractive()

  let sleepy = false
  let lastSpawn: CritterSpawn | null = null

  const applySpawn = (spawn: CritterSpawn): void => {
    sleepy = spawn.sleepy
    lastSpawn = spawn
    head.setTexture(`was-critter-${spawn.critterId}`)

    if (spawn.golden) {
      body.setTint(GOLD)
      belly.setTint(GOLD_BELLY)
      pawL.setTint(GOLD_PAW)
      pawR.setTint(GOLD_PAW)
      head.setTint(GOLD)
      glow.setVisible(true)
    } else {
      const style = rigStyleFor(spawn.critterId)
      body.setTint(sleepy ? coolTint(style.bodyColor) : style.bodyColor)
      belly.setTint(sleepy ? coolTint(style.bellyColor) : style.bellyColor)
      const paw = sleepy ? coolTint(style.pawColor) : style.pawColor
      pawL.setTint(paw)
      pawR.setTint(paw)
      if (sleepy) head.setTint(coolTint(0xffffff))
      else head.clearTint()
      glow.setVisible(false)
    }

    eyes.setVisible(sleepy)
    cap.setVisible(sleepy)
  }

  const setAwake = (awake: boolean): void => {
    // Only a sleeper has the closed-eye overlay; waking drops it so the emoji's
    // own (open) eyes read through. The nightcap stays on.
    eyes.setVisible(sleepy && !awake)
  }

  const flashParts = [body, belly, pawL, pawR, head]

  const flashWhite = (ms: number): void => {
    for (const p of flashParts) p.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    scene.time.delayedCall(ms, () => {
      for (const p of flashParts) p.setTintMode(Phaser.TintModes.MULTIPLY)
      if (lastSpawn) applySpawn(lastSpawn)
    })
  }

  const reset = (): void => {
    inner.setScale(1).setAngle(0).setAlpha(1).setVisible(false)
    for (const p of flashParts) p.setTintMode(Phaser.TintModes.MULTIPLY)
    glow.setVisible(false)
    eyes.setVisible(false)
    cap.setVisible(false)
    head.clearTint()
    sleepy = false
    lastSpawn = null
  }

  return { outer, inner, head, glow, applySpawn, setAwake, flashWhite, reset }
}

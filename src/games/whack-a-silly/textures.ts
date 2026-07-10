/**
 * Procedural scenery + hole textures for Whack-a-Silly. Everything here is
 * generated at runtime (Graphics → generateTexture, or a 2D canvas) at physical
 * pixels so it stays crisp on retina iPads — there are no binary art assets.
 *
 * `px(css)` converts css units to backing pixels (css × dpr); the scene owns it.
 * Each maker is idempotent (guards on `textures.exists`) so a StrictMode double
 * mount or a resize never rebuilds a texture twice. Texture keys are `was-*`.
 *
 * The hole is drawn as a "depth sandwich" (no geometry mask — Phaser's mask on a
 * Container is flaky): a back plate with the dark interior sits behind the
 * critter, a grass skirt and a front dirt lip sit in front, so a critter truly
 * emerges from *inside* the hole instead of popping out from behind it.
 */
import Phaser from 'phaser'

type Px = (css: number) => number

/** Hole / mound geometry in css px, shared by the back plate, lip and layout. */
export const MOUND_GEOM = {
  /** Back-plate texture size. */
  W: 220,
  H: 140,
  /** Hole-opening center inside the back-plate texture. */
  holeCy: 52,
  /** Hole opening radii (a wide, shallow ellipse). */
  holeRx: 75,
  holeRy: 26,
  /** Front-lip texture size (centered on the hole opening). */
  lipW: 200,
  lipH: 96,
} as const

// Dirt palette (fixed — the mound is never tinted).
const DIRT = 0xb08968
const DIRT_MID = 0xbf9974
const DIRT_DARK = 0x8a6a4f
const RIM_HILITE = 0xe6cba0
const HOLE_1 = 0x6f5240
const HOLE_2 = 0x5a4232
const HOLE_3 = 0x40301f

function traceEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
}

/**
 * Back plate: the raised dirt rim + the dark hole interior (layered ellipses
 * receding to near-black). Drawn at BAND+0, behind the critter — the critter
 * rises out of this dark opening. The lower half is hidden by the grass skirt.
 */
export function makeMoundBackTexture(scene: Phaser.Scene, px: Px): void {
  if (scene.textures.exists('was-mound-back')) return
  const g = scene.add.graphics()
  const { W, H, holeCy, holeRx, holeRy } = MOUND_GEOM
  const cx = px(W / 2)
  const cy = px(holeCy)

  // Raised dirt rim: stacked ellipses, darkest at the base, to fake a lip.
  g.fillStyle(DIRT_DARK, 1)
  g.fillEllipse(cx, cy + px(6), px(holeRx * 2 + 34), px(holeRy * 2 + 30))
  g.fillStyle(DIRT, 1)
  g.fillEllipse(cx, cy + px(3), px(holeRx * 2 + 22), px(holeRy * 2 + 20))
  g.fillStyle(DIRT_MID, 1)
  g.fillEllipse(cx, cy, px(holeRx * 2 + 10), px(holeRy * 2 + 10))

  // Dark hole interior — layered ellipses, each smaller / darker / lower so the
  // opening reads as a receding tunnel.
  g.fillStyle(HOLE_1, 1)
  g.fillEllipse(cx, cy, px(holeRx * 2), px(holeRy * 2))
  g.fillStyle(HOLE_2, 1)
  g.fillEllipse(cx, cy + px(3), px(holeRx * 2 - 16), px(holeRy * 2 - 8))
  g.fillStyle(HOLE_3, 1)
  g.fillEllipse(cx, cy + px(6), px(holeRx * 2 - 38), px(holeRy * 2 - 16))

  // Top rim highlight (near edge catching the sky light).
  g.lineStyle(px(3), RIM_HILITE, 0.5)
  g.strokeEllipse(cx, cy - px(2), px(holeRx * 2 + 6), px(holeRy * 2 + 6))

  g.generateTexture('was-mound-back', px(W), px(H))
  g.destroy()
}

/**
 * Front dirt lip: the bottom crescent of the hole rim, drawn OVER the critter
 * (BAND+4). It occludes the critter's paws/lower body so they look like they're
 * gripping the near rim. Built on a canvas so we can punch the opening out with
 * `destination-out`; Graphics can't subtract.
 */
export function makeLipTexture(scene: Phaser.Scene, px: Px): void {
  if (scene.textures.exists('was-lip')) return
  const { lipW, lipH, holeRx, holeRy } = MOUND_GEOM
  const w = px(lipW)
  const h = px(lipH)
  const tex = scene.textures.createCanvas('was-lip', w, h)
  if (!tex) return
  const ctx = tex.getContext()
  const cx = w / 2
  const cy = h / 2

  // Shaded rim: dark base → mid → lit near-edge (stacked, nudged up so the lit
  // band lands on the inner-top of the crescent).
  ctx.fillStyle = '#8a6a4f'
  traceEllipse(ctx, cx, cy + px(3), px(holeRx + 14), px(holeRy + 14))
  ctx.fill()
  ctx.fillStyle = '#bf9974'
  traceEllipse(ctx, cx, cy + px(1), px(holeRx + 9), px(holeRy + 9))
  ctx.fill()
  ctx.fillStyle = '#d0ab80'
  traceEllipse(ctx, cx, cy - px(2), px(holeRx + 4), px(holeRy + 4))
  ctx.fill()

  // Punch the opening (nudged up so the FRONT rim stays thick), then clip away
  // the top half — what remains is the front lip crescent.
  ctx.globalCompositeOperation = 'destination-out'
  traceEllipse(ctx, cx, cy - px(7), px(holeRx), px(holeRy))
  ctx.fill()
  ctx.fillRect(0, 0, w, cy)
  ctx.globalCompositeOperation = 'source-over'

  // Soft cast shadow just under the lip (grounds it on the grass).
  ctx.fillStyle = 'rgba(60,40,25,0.22)'
  traceEllipse(ctx, cx, cy + px(holeRy) + px(2), px(holeRx - 4), px(7))
  ctx.fill()

  tex.refresh()
}

/**
 * Soft dark ground shadow (layered translucent ellipses). Used by the launch
 * bop celebration — it shrinks as the critter flies up and grows on landing.
 */
export function makeShadowTexture(scene: Phaser.Scene, px: Px): void {
  if (scene.textures.exists('was-shadow')) return
  const g = scene.add.graphics()
  const spec: [number, number, number][] = [
    [72, 22, 0.1],
    [56, 17, 0.13],
    [40, 12, 0.16],
  ]
  for (const [rx, ry, a] of spec) {
    g.fillStyle(0x000000, a)
    g.fillEllipse(px(80), px(28), px(rx * 2), px(ry * 2))
  }
  g.generateTexture('was-shadow', px(160), px(56))
  g.destroy()
}

/** Fluffy cartoon cloud (overlapping white puffs on a flat base). */
export function makeCloudTexture(scene: Phaser.Scene, px: Px): void {
  if (scene.textures.exists('was-cloud')) return
  const g = scene.add.graphics()
  const w = px(170)
  const h = px(84)
  // Soft shadow underside.
  g.fillStyle(0xd7ecff, 0.9)
  g.fillRoundedRect(px(26), px(50), px(118), px(26), px(13))
  g.fillCircle(px(52), px(52), px(26))
  g.fillCircle(px(88), px(44), px(31))
  g.fillCircle(px(120), px(52), px(24))
  // White puffs on top.
  g.fillStyle(0xffffff, 1)
  g.fillRoundedRect(px(28), px(44), px(114), px(24), px(12))
  g.fillCircle(px(52), px(46), px(24))
  g.fillCircle(px(88), px(38), px(30))
  g.fillCircle(px(120), px(46), px(22))
  g.generateTexture('was-cloud', w, h)
  g.destroy()
}

/** Little grass tuft (a few blades) scattered on the lawn for texture. */
export function makeTuftTexture(scene: Phaser.Scene, px: Px): void {
  if (scene.textures.exists('was-tuft')) return
  const g = scene.add.graphics()
  const w = px(32)
  const h = px(26)
  g.fillStyle(0x4e9c37, 1)
  g.fillTriangle(px(3), px(26), px(8), px(5), px(13), px(26))
  g.fillTriangle(px(19), px(26), px(24), px(7), px(29), px(26))
  g.fillStyle(0x5cb54a, 1)
  g.fillTriangle(px(10), px(26), px(16), px(1), px(22), px(26))
  g.generateTexture('was-tuft', w, h)
  g.destroy()
}

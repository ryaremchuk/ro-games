/**
 * Texture generation for the Feed the Monster scene.
 *
 * Free functions that pre-render the scene's procedural textures (emoji/glyph
 * canvas strikes, blob bodies, particles, halo, plate, badges) onto a Phaser
 * scene. Factored out of the scene so the geometry cluster stays small and the
 * PURE helpers (jitter, blobPoints, foodScale) are unit-testable in isolation.
 *
 * The scene passes a live snapshot (dpr, body radius, episode, friend color)
 * into `buildSceneTextures` and delegates; the factories read the scene's
 * texture manager + graphics factory but hold no scene state of their own.
 */
import Phaser from 'phaser'
import { darken } from './journey'
import type { Episode } from './journey'
import { foodById } from './logic'
import { allRecipeFoods } from './recipes'
import { artKey } from './art'
import type { XY } from './layout'

// Per-food visual-scale corrections. Foods are normalized by their max
// dimension, so a compact round shape that fills its footprint in BOTH axes
// reads far heavier than the elongated foods (banana, carrot, cucumber) that
// share the same footprint but are thin. 1 = default; shrink the outliers.
const FOOD_ART_SCALE: Record<string, number> = {
  lemon: 0.8, // big round citrus — dwarfed the thinner foods at full size
}

/**
 * Height the belt pieces are AUTHORED at, in CSS px. The scene stretches them to
 * layout.beltHeight, so this only fixes their internal proportions (tread rib
 * size, front-edge lip, roller diameter) — not how tall the belt looks.
 */
const BELT_TEX_H_CSS = 74

/** Per-food visual-scale correction (evens out oddly-cropped art slices). */
export function foodScale(foodId: string): number {
  return FOOD_ART_SCALE[foodId] ?? 1
}

/** Deterministic 0..1 jitter so blob shapes are stable per seed. */
export function jitter(i: number, seed: number): number {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** Smooth closed blob outline: n jittered radii, sampled through midpoints. */
export function blobPoints(cx: number, cy: number, r: number, seed: number): Phaser.Math.Vector2[] {
  const n = 8
  const verts: XY[] = []
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2
    const rad = r * (0.9 + 0.1 * jitter(i, seed))
    verts.push({ x: cx + Math.cos(angle) * rad, y: cy + Math.sin(angle) * rad })
  }
  const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const samples: Phaser.Math.Vector2[] = []
  for (let i = 0; i < n; i++) {
    const p0 = verts[i]
    const p1 = verts[(i + 1) % n]
    const p2 = verts[(i + 2) % n]
    const a = mid(p0, p1)
    const c = mid(p1, p2)
    for (let s = 0; s < 10; s++) {
      const t = s / 10
      const u = 1 - t
      samples.push(
        new Phaser.Math.Vector2(
          u * u * a.x + 2 * u * t * p1.x + t * t * c.x,
          u * u * a.y + 2 * u * t * p1.y + t * t * c.y,
        ),
      )
    }
  }
  return samples
}

/** Pre-render an emoji to a CanvasTexture at physical pixels (crisp on retina). */
export function emojiTexture(
  scene: Phaser.Scene,
  dpr: number,
  key: string,
  emoji: string,
  cssSize: number,
): void {
  if (scene.textures.exists(key)) return
  const fontPx = Math.round(cssSize * dpr)
  const pad = Math.ceil(fontPx * 0.25) // emoji overflow the em box; don't trust measureText
  const side = fontPx + pad * 2
  const tex = scene.textures.createCanvas(key, side, side)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.font = `${fontPx}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, side / 2, side / 2 + fontPx * 0.03)
  tex.refresh() // required for the WebGL upload
}

/** Pre-render a bold glyph (e.g. "?") — white with a dark outline so it reads
 * on any slot background (saturated colour, rainbow, or grey). */
export function glyphTexture(
  scene: Phaser.Scene,
  dpr: number,
  key: string,
  char: string,
  cssSize: number,
): void {
  if (scene.textures.exists(key)) return
  const fontPx = Math.round(cssSize * dpr)
  const pad = Math.ceil(fontPx * 0.32)
  const side = fontPx + pad * 2
  const tex = scene.textures.createCanvas(key, side, side)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.font = `900 ${fontPx}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(61,58,75,0.85)'
  ctx.lineWidth = Math.max(2, fontPx * 0.16)
  ctx.strokeText(char, side / 2, side / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(char, side / 2, side / 2)
  tex.refresh() // required for the WebGL upload
}

export function makeBlobTexture(
  scene: Phaser.Scene,
  key: string,
  radius: number,
  color: number,
  seed: number,
): void {
  if (scene.textures.exists(key)) return
  const side = Math.ceil(radius * 2.4)
  const g = scene.add.graphics()
  g.fillStyle(color, 1)
  g.fillPoints(blobPoints(side / 2, side / 2, radius, seed), true)
  g.generateTexture(key, side, side)
  g.destroy()
}

/** Body blob texture per friend color: blob + darker patch + antenna. */
export function monsterTexture(scene: Phaser.Scene, color: number, bodyR: number): string {
  const key = `ftm-monster-${color.toString(16)}`
  if (scene.textures.exists(key)) return key
  const r = bodyR
  const side = Math.ceil(r * 3)
  const cx = side / 2
  const cy = side / 2 + r * 0.1
  const g = scene.add.graphics()
  g.fillStyle(color, 1)
  g.fillRect(cx - r * 0.05, cy - r * 1.24, r * 0.1, r * 0.5)
  g.fillCircle(cx, cy - r * 1.28, r * 0.13)
  g.fillPoints(blobPoints(cx, cy, r, 7), true)
  g.fillStyle(darken(color), 1)
  g.fillEllipse(cx - r * 0.2, cy + r * 0.52, r * 1.0, r * 0.42)
  g.generateTexture(key, side, side)
  g.destroy()
  return key
}

// A magpie: black head and back, white belly, a long dark tail, one big friendly
// eye, an orange beak. Mischievous, never menacing — the thief is shooed, it
// squawks, it comes back another day. A magpie because it flies, reads
// universally as a thief, and looks at home in all four episode themes.
const MAGPIE_DARK = 0x2b2b38
const MAGPIE_SHEEN = 0x3f4a6b
const MAGPIE_LIGHT = 0xf4f4f8
const BEAK = 0xf7a03c

/** Canvas the bird frames are authored on, in CSS px (all three share it). */
const THIEF_W_CSS = 132
const THIEF_H_CSS = 108

/**
 * The three thief frames on one shared canvas and one shared anchor:
 * `ftm-thief-fly-up` / `-fly-down` (alternate for flight) and `-perch` (standing,
 * head down, beak forward mid-peck).
 *
 * FALLBACK ONLY now: `art/thief-*.png` ship, so thiefMode.frameKey picks the
 * sprites through the usual hasArt() contract and these shapes are what a player
 * sees before the art loads. Keep the three poses and the shared anchor in step
 * with the sprites — the same display box is force-fit onto whichever wins.
 */
function buildThiefFrames(scene: Phaser.Scene, px: (css: number) => number): void {
  const w = px(THIEF_W_CSS)
  const h = px(THIEF_H_CSS)
  // Body centre, identical in every frame — this is the shared anchor.
  const cx = w * 0.46
  const cy = h * 0.54
  const bodyR = h * 0.26

  const frames: Array<{ key: string; wing: 'up' | 'down' | 'folded'; perch: boolean }> = [
    { key: 'ftm-thief-fly-up', wing: 'up', perch: false },
    { key: 'ftm-thief-fly-down', wing: 'down', perch: false },
    { key: 'ftm-thief-perch', wing: 'folded', perch: true },
  ]

  for (const frame of frames) {
    if (scene.textures.exists(frame.key)) continue
    const g = scene.add.graphics()

    // Tail: a long dark wedge sweeping back and up.
    g.fillStyle(MAGPIE_DARK, 1)
    g.fillTriangle(
      cx - bodyR * 0.4,
      cy,
      cx - bodyR * 3.1,
      frame.perch ? cy + bodyR * 0.9 : cy - bodyR * 0.5,
      cx - bodyR * 2.9,
      frame.perch ? cy + bodyR * 1.5 : cy + bodyR * 0.2,
    )

    // Legs (perched only) — two little sticks onto the plate.
    if (frame.perch) {
      g.lineStyle(px(5), BEAK, 1)
      for (const dx of [-bodyR * 0.3, bodyR * 0.25]) {
        g.lineBetween(cx + dx, cy + bodyR * 0.7, cx + dx, cy + bodyR * 1.5)
      }
    }

    // Body: white belly under a dark back.
    g.fillStyle(MAGPIE_LIGHT, 1)
    g.fillEllipse(cx, cy + bodyR * 0.18, bodyR * 1.85, bodyR * 1.7)
    g.fillStyle(MAGPIE_DARK, 1)
    g.fillEllipse(cx - bodyR * 0.15, cy - bodyR * 0.42, bodyR * 1.75, bodyR * 1.15)

    // Head: dark, tilted down for the peck frame.
    const headX = cx + bodyR * 0.95
    const headY = frame.perch ? cy - bodyR * 0.05 : cy - bodyR * 0.72
    g.fillStyle(MAGPIE_DARK, 1)
    g.fillCircle(headX, headY, bodyR * 0.74)

    // Beak, forward (and down when pecking).
    g.fillStyle(BEAK, 1)
    g.fillTriangle(
      headX + bodyR * 0.5,
      headY - bodyR * 0.16,
      headX + bodyR * 0.5,
      headY + bodyR * 0.22,
      headX + bodyR * (frame.perch ? 1.5 : 1.45),
      headY + bodyR * (frame.perch ? 0.6 : 0.05),
    )

    // One big friendly eye with a catchlight — the whole difference between
    // "cheeky" and "creepy".
    g.fillStyle(0xffffff, 1)
    g.fillCircle(headX + bodyR * 0.2, headY - bodyR * 0.2, bodyR * 0.27)
    g.fillStyle(0x1a1622, 1)
    g.fillCircle(headX + bodyR * 0.26, headY - bodyR * 0.18, bodyR * 0.15)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(headX + bodyR * 0.2, headY - bodyR * 0.26, bodyR * 0.06)

    // The wing, which is the only thing that differs between the flight frames.
    g.fillStyle(MAGPIE_SHEEN, 1)
    if (frame.wing === 'up') {
      g.fillTriangle(
        cx - bodyR * 0.2,
        cy - bodyR * 0.3,
        cx + bodyR * 0.9,
        cy - bodyR * 2.5,
        cx - bodyR * 1.5,
        cy - bodyR * 1.5,
      )
    } else if (frame.wing === 'down') {
      g.fillTriangle(
        cx - bodyR * 0.2,
        cy - bodyR * 0.1,
        cx + bodyR * 0.8,
        cy + bodyR * 1.9,
        cx - bodyR * 1.5,
        cy + bodyR * 1.1,
      )
    } else {
      g.fillEllipse(cx - bodyR * 0.25, cy + bodyR * 0.05, bodyR * 1.2, bodyR * 0.8)
    }
    // A white wing flash — the magpie's signature.
    g.fillStyle(MAGPIE_LIGHT, 0.9)
    if (frame.wing === 'folded') {
      g.fillEllipse(cx - bodyR * 0.5, cy + bodyR * 0.2, bodyR * 0.5, bodyR * 0.42)
    }

    g.generateTexture(frame.key, w, h)
    g.destroy()
  }
}

/** Canvas the `+` / `=` glyphs are authored on, CSS px (square). */
const OP_TEX_CSS = 40
/**
 * Operator ink: a soft slate, deliberately QUIETER than a food or a ✓ badge. The
 * glyphs are grammar, not content — the child has to read the pictures first and
 * the joins second.
 */
const OP_INK = 0x6f6b80

/**
 * `ftm-plus` and `ftm-equals` — two crossed rounded bars, and two stacked ones.
 * The bar thickness and the gap are shares of the canvas, so the pair stays a
 * matched set at whatever size the recipe panel resolves to.
 */
function buildOperatorGlyphs(scene: Phaser.Scene, px: (css: number) => number): void {
  const side = px(OP_TEX_CSS)
  const bar = side * 0.2
  const arm = side * 0.72

  if (!scene.textures.exists('ftm-plus')) {
    const g = scene.add.graphics()
    g.fillStyle(OP_INK, 1)
    g.fillRoundedRect((side - arm) / 2, (side - bar) / 2, arm, bar, bar / 2)
    g.fillRoundedRect((side - bar) / 2, (side - arm) / 2, bar, arm, bar / 2)
    g.generateTexture('ftm-plus', side, side)
    g.destroy()
  }

  if (!scene.textures.exists('ftm-equals')) {
    const gap = side * 0.16
    const g = scene.add.graphics()
    g.fillStyle(OP_INK, 1)
    g.fillRoundedRect((side - arm) / 2, side / 2 - gap / 2 - bar, arm, bar, bar / 2)
    g.fillRoundedRect((side - arm) / 2, side / 2 + gap / 2, arm, bar, bar / 2)
    g.generateTexture('ftm-equals', side, side)
    g.destroy()
  }
}

/**
 * Build every procedural texture the scene needs for the current journey point
 * (friend body, plate, splash, ban/check badges, "?" glyph, particles, halo,
 * per-food emoji strikes). Idempotent: each factory no-ops if its key exists.
 */
export function buildSceneTextures(
  scene: Phaser.Scene,
  opts: { dpr: number; bodyR: number; episode: Episode; color: number; foodCss: number },
): void {
  const px = (css: number): number => css * opts.dpr
  const hasArt = (name: string): boolean => scene.textures.exists(artKey(name))

  monsterTexture(scene, opts.color, opts.bodyR)

  // Plate under each tray food.
  if (!scene.textures.exists('ftm-plate')) {
    const pr = px(42)
    const g = scene.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillCircle(pr, pr, pr)
    g.fillStyle(0xf7e3cd, 1)
    g.fillCircle(pr, pr, pr * 0.72)
    g.generateTexture('ftm-plate', pr * 2, pr * 2)
    g.destroy()
  }

  // Color splash for the task panel tiles (white, tinted per request color).
  makeBlobTexture(scene, 'ftm-splash', px(26), 0xffffff, 11)

  // Ban sign for "not" rounds: red ring + diagonal bar (🚫, drawn crisp).
  if (!scene.textures.exists('ftm-ban')) {
    const r = px(34)
    const stroke = px(8)
    const side = r * 2 + stroke * 2
    const g = scene.add.graphics()
    g.lineStyle(stroke, 0xe5484d, 1)
    g.strokeCircle(side / 2, side / 2, r)
    const off = r * Math.SQRT1_2
    g.lineBetween(side / 2 - off, side / 2 - off, side / 2 + off, side / 2 + off)
    g.generateTexture('ftm-ban', side, side)
    g.destroy()
  }

  // "Got it" badge: a white disc + green tick, stamped on collected tiles.
  if (!scene.textures.exists('ftm-check')) {
    const r = px(15)
    const side = r * 2
    const g = scene.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillCircle(r, r, r)
    g.lineStyle(px(5), 0x2f9e44, 1)
    g.beginPath()
    g.moveTo(side * 0.3, side * 0.52)
    g.lineTo(side * 0.45, side * 0.68)
    g.lineTo(side * 0.72, side * 0.34)
    g.strokePath()
    g.generateTexture('ftm-check', side, side)
    g.destroy()
  }

  // "?" glyph — "a food goes here, you pick which" — on the you-choose slots
  // (colour requests, the pattern answer, the not-round progress sockets).
  glyphTexture(scene, opts.dpr, 'ftm-q', '?', 30)

  // The recipe equation's operators, for the pot's panel: `part + part = dish`.
  // Drawn as SHAPES, not text — the player cannot read, so "+" and "=" have to
  // arrive as pictures with the same fat, soft, rounded look as the rest of the
  // art. Authored square at OP_TEX_CSS and stretched to the solved cell size, so
  // one texture serves every viewport (see layout.recipePanel).
  buildOperatorGlyphs(scene, px)

  // Particles.
  if (!scene.textures.exists('ftm-confetti')) {
    const g = scene.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(0, 0, px(12), px(9), px(3))
    g.generateTexture('ftm-confetti', px(12), px(9))
    g.destroy()
  }
  if (!scene.textures.exists('ftm-dot')) {
    const g = scene.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillCircle(px(6), px(6), px(6))
    g.generateTexture('ftm-dot', px(12), px(12))
    g.destroy()
  }
  emojiTexture(scene, opts.dpr, 'ftm-star', '⭐', 30)
  // The commission ask: "make me one" (see requestBubble.showCommission).
  emojiTexture(scene, opts.dpr, 'ftm-pencil', '✏️', 40)

  // ── The thief ────────────────────────────────────────────────────────────
  // Separate FULL-BODY frames, swapped — no face-anchored parts, no rigged wings.
  // That is what the whack-a-mole critters do, and it is the pattern that has not
  // caused layout bugs; anything hung off a socket has to sit right at every scale
  // on every screen (see journey.auraIntensity for why the worn accessories went).
  // All three thief frames share ONE body anchor, so swapping them cannot make the
  // bird jump.
  buildThiefFrames(scene, px)

  // The kitchen POT: a friendly wide pot, 3/4 view, two handles, NO LID (the
  // contents must be visible — that is the whole read of a kitchen round). Drawn
  // neutral so episode.palette can tint it, thick soft outline to match the food
  // sprites' style.
  if (!scene.textures.exists('ftm-pot')) {
    const w = px(150)
    const h = px(120)
    const g = scene.add.graphics()
    const bodyTop = h * 0.3
    // Handles first, so the body overlaps them.
    g.lineStyle(px(11), 0x8f8f98, 1)
    for (const side of [-1, 1] as const) {
      g.beginPath()
      g.arc(
        w / 2 + side * w * 0.35,
        bodyTop + (h - bodyTop) * 0.28,
        w * 0.12,
        side < 0 ? Math.PI * 0.35 : Math.PI * 0.65,
        side < 0 ? Math.PI * 1.65 : Math.PI * 1.95,
      )
      g.strokePath()
    }
    // Body: a bucket that tapers slightly toward the base.
    g.fillStyle(0x6f6f78, 1)
    g.fillRoundedRect(w * 0.13, bodyTop, w * 0.74, h - bodyTop, {
      tl: px(6),
      tr: px(6),
      bl: px(22),
      br: px(22),
    })
    // Rim, and the dark opening behind it.
    g.fillStyle(0x8f8f98, 1)
    g.fillEllipse(w / 2, bodyTop, w * 0.84, h * 0.24)
    g.fillStyle(0x413f4a, 1)
    g.fillEllipse(w / 2, bodyTop + px(2), w * 0.7, h * 0.17)
    // A soft highlight down the left of the body — makes it read as metal.
    g.fillStyle(0xb4b4bd, 0.5)
    g.fillRoundedRect(w * 0.2, bodyTop + h * 0.16, w * 0.1, (h - bodyTop) * 0.62, px(8))
    g.generateTexture('ftm-pot', w, h)
    g.destroy()
  }

  // ── Conveyor belt ────────────────────────────────────────────────────────
  // Drawn procedurally and NEUTRAL GREY on purpose: every piece is tinted by
  // episode.palette.table at runtime, so one set of art themes itself across all
  // four episodes instead of needing four variants. A shipped
  // `art/belt-strip.png` etc. would take over through the same hasArt() contract
  // every other look in this game already uses.

  // The running surface, as a horizontally TILEABLE segment: the tread pattern
  // must meet itself at both edges, because the belt is drawn as a tileSprite
  // whose tilePositionX scrolls — that scroll IS the visible motion.
  if (!scene.textures.exists('ftm-belt')) {
    const period = px(48)
    const h = px(BELT_TEX_H_CSS)
    const lip = h * 0.28 // darker front edge, so the belt reads as 3/4 view
    const g = scene.add.graphics()
    g.fillStyle(0xd9d9de, 1)
    g.fillRect(0, 0, period, h - lip)
    g.fillStyle(0xb2b2ba, 1)
    g.fillRect(0, h - lip, period, lip)
    // Two tread ribs per period, inset so neither touches the seam.
    g.fillStyle(0xc4c4cb, 1)
    for (const at of [period * 0.22, period * 0.68]) {
      g.fillRect(at, px(3), period * 0.1, h - lip - px(6))
    }
    // A soft highlight along the top edge — the light on a metal belt.
    g.fillStyle(0xf0f0f4, 0.75)
    g.fillRect(0, 0, period, px(3))
    g.generateTexture('ftm-belt', period, h)
    g.destroy()
  }

  // One end roller / drum cap, seen from the side; mirrored for the other end.
  if (!scene.textures.exists('ftm-belt-roller')) {
    const r = px(BELT_TEX_H_CSS / 2)
    const g = scene.add.graphics()
    g.fillStyle(0xb2b2ba, 1)
    g.fillCircle(r, r, r)
    g.fillStyle(0xd9d9de, 1)
    g.fillCircle(r, r, r * 0.62)
    g.fillStyle(0x9a9aa2, 1)
    g.fillCircle(r, r, r * 0.2)
    g.generateTexture('ftm-belt-roller', r * 2, r * 2)
    g.destroy()
  }

  // Nothing is drawn at the belt's entry edge. A doorway texture used to live
  // here, but on the device it read as a brown rectangle on top of the first
  // plate rather than a kitchen, so the belt is now just the strip and its two
  // rollers; a dish simply rides in from off screen (see conveyorMode.buildBelt).

  // Growth-aura halo: a soft radial glow, tinted per friend and scaled/faded
  // by growth in applyAura. A CanvasTexture gradient stays a crisp bloom at
  // any display size (a generated blob would band when scaled up).
  if (!scene.textures.exists('ftm-halo')) {
    const rad = px(150)
    const size = rad * 2
    const tex = scene.textures.createCanvas('ftm-halo', size, size)
    if (tex) {
      const ctx = tex.getContext()
      const grad = ctx.createRadialGradient(rad, rad, rad * 0.08, rad, rad, rad)
      grad.addColorStop(0, 'rgba(255,255,255,0.95)')
      grad.addColorStop(0.4, 'rgba(255,255,255,0.4)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, size, size)
      tex.refresh() // required for the WebGL upload
    }
  }

  // Every food this episode can put on the tray — its own pool, PLUS anything a
  // kitchen recipe names. A recipe's parts are pushed onto the tray by id
  // regardless of the episode (a burger needs bread wherever it is cooked), so
  // skipping them here would leave a missing-texture box on the plate. They all
  // happen to ship art today; this makes it structural rather than lucky.
  const needed = new Map<string, string>()
  for (const food of opts.episode.foods) needed.set(food.id, food.emoji)
  for (const id of allRecipeFoods()) needed.set(id, foodById(id).emoji)
  for (const [id, emoji] of needed) {
    if (!hasArt(`food-${id}`)) emojiTexture(scene, opts.dpr, `ftm-food-${id}`, emoji, opts.foodCss)
  }
}

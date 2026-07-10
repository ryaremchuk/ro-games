import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { BIRDS } from './logic'
import type { BirdKind } from './logic'
import { STAR_DROP_TIERS, buildTapScript } from './starDrop'
import type { StarTapEvent } from './starDrop'

/**
 * Victory-star reward overlay — a toddler-simplified, text-free reskin of the
 * Brawl Stars "Starr Drop" open. It renders a full-screen container ABOVE the
 * (paused) gameplay and drives a pre-rolled outcome as pure theater: the child
 * taps the whole screen a few times, the gold star upgrades / fakes out per the
 * script, then bursts open to reveal the reward bird. When it finishes it calls
 * `onComplete(target)`; the scene persists the bird and advances the level.
 *
 * All art is procedural (Graphics → generateTexture / canvas radial gradients),
 * no assets. All motion is Phaser tweens/timers — never React state. There is
 * zero text: the only glyphs are the star's ink eyes and smile.
 */

const INK = 0x3d3a4b

// Depth stack, all above the scene's rainbow (60) and confetti (58).
const DEPTH = {
  scrim: 100,
  wash: 101,
  rays: 102,
  halo: 103,
  star: 104,
  reward: 105,
  particles: 106,
  flash: 110,
}

/** Overlay phases; `starDropActive` (testHook) is true until `done`. */
type Phase = 'receiving' | 'idle' | 'busy' | 'opening' | 'done'

export interface StarDropDeps {
  /** The pre-rolled reward bird (rarity ladder = tier). */
  target: BirdKind
  /** Reward bird body color, for the reveal rays / confetti tint. */
  birdColor: number
  /** Builds the reward bird's procedural art at the given radius (scene-owned). */
  makeBirdImage: (rPx: number) => Phaser.GameObjects.Image
  /** Called once, after the reveal fades out. */
  onComplete: (reward: BirdKind) => void
}

/** Darken a color toward black (factor < 1) for the saturated tier washes. */
function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor)
  const g = Math.round(((color >> 8) & 0xff) * factor)
  const b = Math.round((color & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}

/** Dark, saturated full-screen wash for a tier (so the gold star pops). */
function tierWash(kind: BirdKind): number {
  return darken(BIRDS[kind].color, 0.34)
}

export class StarDropOverlay {
  private phase: Phase = 'receiving'
  private readonly script: StarTapEvent[]
  private scriptIndex = 0
  private tierIdx = 0

  // Layout (recomputed on start + relayout).
  private cx = 0
  private cy = 0
  private R = 0

  // Display objects.
  private scrim!: Phaser.GameObjects.Graphics
  private flash!: Phaser.GameObjects.Graphics
  private wash!: Phaser.GameObjects.Image
  private halo!: Phaser.GameObjects.Image
  private rays!: Phaser.GameObjects.Image
  private ring!: Phaser.GameObjects.Image
  private starWrap!: Phaser.GameObjects.Container
  private star!: Phaser.GameObjects.Image
  private starGlow!: Phaser.GameObjects.Image
  private eyeL!: Phaser.GameObjects.Image
  private eyeR!: Phaser.GameObjects.Image
  private mouth!: Phaser.GameObjects.Image
  private rewardBird?: Phaser.GameObjects.Image
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private embers!: Phaser.GameObjects.Particles.ParticleEmitter

  // Owned timers (removed on destroy; independent of the scene's level timers).
  private timers: Phaser.Time.TimerEvent[] = []

  private readonly scene: Phaser.Scene
  private readonly deps: StarDropDeps

  constructor(scene: Phaser.Scene, deps: StarDropDeps) {
    this.scene = scene
    this.deps = deps
    this.script = buildTapScript(deps.target, Math.random)
  }

  // ─── testHook surface ──────────────────────────────────────────────────────

  isActive(): boolean {
    return this.phase !== 'done'
  }
  currentTier(): BirdKind {
    return STAR_DROP_TIERS[this.tierIdx]
  }
  /** Taps left including the closing 'open' (0 once the star has opened). */
  tapsLeft(): number {
    return Math.max(0, this.script.length - this.scriptIndex)
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    this.computeLayout()
    this.buildTextures()
    this.buildObjects()
    this.scene.input.on('pointerdown', this.onPointerDown)
    this.playReceive()
  }

  destroy(): void {
    this.phase = 'done'
    this.scene.input.off('pointerdown', this.onPointerDown)
    for (const t of this.timers) t.remove(false)
    this.timers = []
    const kill = (o?: Phaser.GameObjects.GameObject) => o?.destroy()
    for (const o of [
      this.scrim,
      this.flash,
      this.wash,
      this.halo,
      this.rays,
      this.ring,
      this.starWrap,
      this.rewardBird,
      this.confetti,
      this.sparkles,
      this.embers,
    ]) {
      // Kill any running tweens on the object before destroying it.
      if (o) this.scene.tweens.killTweensOf(o)
      kill(o)
    }
  }

  /** Resize landed while the overlay was up: re-cover the screen, re-center. */
  relayout(): void {
    if (this.phase === 'done') return
    this.computeLayout()
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    this.scrim.clear().fillStyle(0x0a0a14, 1).fillRect(0, 0, w, h)
    this.flash.clear().fillStyle(0xffffff, 1).fillRect(0, 0, w, h)
    const cover = Math.max(w, h) * 1.6
    this.wash.setPosition(this.cx, this.cy).setDisplaySize(cover, cover)
    this.rays.setPosition(this.cx, this.cy).setDisplaySize(cover, cover)
    this.halo.setPosition(this.cx, this.cy).setDisplaySize(this.R * 4, this.R * 4)
    this.ring.setPosition(this.cx, this.cy)
    this.starWrap.setPosition(this.cx, this.cy)
    this.rewardBird?.setPosition(this.cx, this.cy)
  }

  private delay(ms: number, fn: () => void): void {
    this.timers.push(this.scene.time.delayedCall(ms, fn))
  }

  private computeLayout(): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    this.cx = w / 2
    this.cy = h * 0.46
    // Star ~25% of min(w,h) across → outer radius an eighth of the min side.
    this.R = Math.min(w, h) * 0.125
  }

  // ─── Procedural textures ───────────────────────────────────────────────────

  private buildTextures(): void {
    const R = Math.round(this.R)
    this.makeStarTexture(`sd-star-${R}`, R)
    this.makeEyeTexture(`sd-eye-${R}`, R)
    this.makeSmileTexture(`sd-smile-${R}`, R)
    this.makeGlowTexture('sd-glow', 256)
    this.makeRingTexture('sd-ring', 256)
    this.makeRaysTexture('sd-rays', 256)
  }

  private makeStarTexture(key: string, R: number): void {
    if (this.scene.textures.exists(key)) return
    const g = this.scene.add.graphics()
    const pad = Math.ceil(R * 0.32)
    const c = R + pad
    const pts: Phaser.Math.Vector2[] = []
    // Six-pointed star: 12 vertices alternating outer/inner radius.
    for (let i = 0; i < 12; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 6
      const rad = i % 2 === 0 ? R : R * 0.52
      pts.push(new Phaser.Math.Vector2(c + Math.cos(ang) * rad, c + Math.sin(ang) * rad))
    }
    g.fillStyle(0xffb300, 1) // deep-gold base rim
    g.fillPoints(pts, true)
    const inner = pts.map((p) => new Phaser.Math.Vector2(c + (p.x - c) * 0.8, c + (p.y - c) * 0.8))
    g.fillStyle(0xffd93d, 1) // bright gold face
    g.fillPoints(inner, true)
    g.fillStyle(0xfff3b0, 0.85) // top gloss
    g.fillEllipse(c, c - R * 0.28, R * 0.7, R * 0.34)
    g.generateTexture(key, c * 2, c * 2)
    g.destroy()
  }

  private makeEyeTexture(key: string, R: number): void {
    if (this.scene.textures.exists(key)) return
    const r = Math.max(2, Math.round(R * 0.1))
    const g = this.scene.add.graphics()
    g.fillStyle(INK, 1)
    g.fillCircle(r, r, r)
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(r * 0.7, r * 0.7, r * 0.34) // glint
    g.generateTexture(key, r * 2, r * 2)
    g.destroy()
  }

  private makeSmileTexture(key: string, R: number): void {
    if (this.scene.textures.exists(key)) return
    const w = Math.max(4, Math.round(R * 0.5))
    const h = Math.max(3, Math.round(R * 0.3))
    const g = this.scene.add.graphics()
    g.lineStyle(Math.max(2, R * 0.05), INK, 1)
    g.beginPath()
    g.arc(w / 2, 0, w / 2, 0.12 * Math.PI, 0.88 * Math.PI)
    g.strokePath()
    g.generateTexture(key, w, h)
    g.destroy()
  }

  /** White soft radial gradient — tinted per use (wash / halo / glow). */
  private makeGlowTexture(key: string, size: number): void {
    if (this.scene.textures.exists(key)) return
    const tex = this.scene.textures.createCanvas(key, size, size)
    if (!tex) return
    const ctx = tex.getContext()
    const c = size / 2
    const grd = ctx.createRadialGradient(c, c, 0, c, c, c)
    grd.addColorStop(0, 'rgba(255,255,255,1)')
    grd.addColorStop(0.45, 'rgba(255,255,255,0.55)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, size, size)
    tex.refresh()
  }

  private makeRingTexture(key: string, size: number): void {
    if (this.scene.textures.exists(key)) return
    const g = this.scene.add.graphics()
    g.lineStyle(size * 0.05, 0xffffff, 1)
    g.strokeCircle(size / 2, size / 2, size / 2 - size * 0.05)
    g.generateTexture(key, size, size)
    g.destroy()
  }

  /** White sunburst rays — tinted per use (buildup white / reward bird color). */
  private makeRaysTexture(key: string, size: number): void {
    if (this.scene.textures.exists(key)) return
    const g = this.scene.add.graphics()
    const c = size / 2
    const n = 12
    g.fillStyle(0xffffff, 1)
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = a0 + ((Math.PI * 2) / n) * 0.4
      g.beginPath()
      g.moveTo(c, c)
      g.lineTo(c + Math.cos(a0) * c, c + Math.sin(a0) * c)
      g.lineTo(c + Math.cos(a1) * c, c + Math.sin(a1) * c)
      g.closePath()
      g.fillPath()
    }
    g.generateTexture(key, size, size)
    g.destroy()
  }

  // ─── Object graph ──────────────────────────────────────────────────────────

  private buildObjects(): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const R = Math.round(this.R)
    const cover = Math.max(w, h) * 1.6

    this.scrim = this.scene.add
      .graphics()
      .fillStyle(0x0a0a14, 1)
      .fillRect(0, 0, w, h)
      .setDepth(DEPTH.scrim)
      .setAlpha(0)

    this.wash = this.scene.add
      .image(this.cx, this.cy, 'sd-glow')
      .setDepth(DEPTH.wash)
      .setDisplaySize(cover, cover)
      .setTint(tierWash('green'))
      .setAlpha(0)

    this.rays = this.scene.add
      .image(this.cx, this.cy, 'sd-rays')
      .setDepth(DEPTH.rays)
      .setDisplaySize(cover, cover)
      .setTint(0xffffff)
      .setAlpha(0)

    this.halo = this.scene.add
      .image(this.cx, this.cy, 'sd-glow')
      .setDepth(DEPTH.halo)
      .setDisplaySize(this.R * 4, this.R * 4)
      .setTint(0xffe38a)
      .setAlpha(0)

    this.ring = this.scene.add
      .image(this.cx, this.cy, 'sd-ring')
      .setDepth(DEPTH.star - 1)
      .setDisplaySize(this.R * 2, this.R * 2)
      .setAlpha(0)

    // Star + face grouped so scale/spin/zoom move them together.
    this.star = this.scene.add.image(0, 0, `sd-star-${R}`)
    this.starGlow = this.scene.add
      .image(0, 0, 'sd-glow')
      .setDisplaySize(this.R * 2.6, this.R * 2.6)
      .setTint(0xffffff)
      .setAlpha(0)
    this.eyeL = this.scene.add.image(-this.R * 0.34, -this.R * 0.06, `sd-eye-${R}`)
    this.eyeR = this.scene.add.image(this.R * 0.34, -this.R * 0.06, `sd-eye-${R}`)
    this.mouth = this.scene.add.image(0, this.R * 0.34, `sd-smile-${R}`)
    this.starWrap = this.scene.add
      .container(this.cx, this.cy, [this.star, this.starGlow, this.eyeL, this.eyeR, this.mouth])
      .setDepth(DEPTH.star)
      .setScale(0)

    this.confetti = this.scene.add
      .particles(0, 0, 'sl-confetti', {
        speed: { min: 140, max: 380 },
        gravityY: 620,
        lifespan: { min: 900, max: 1500 },
        scale: { start: 1.2, end: 0.2 },
        rotate: { start: 0, end: 360 },
        tint: [0xff6b6b, 0xffa94d, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x9b5de5],
        emitting: false,
      })
      .setDepth(DEPTH.particles)
    this.sparkles = this.scene.add
      .particles(0, 0, 'sl-spark', {
        speed: { min: 60, max: 220 },
        lifespan: 480,
        scale: { start: 0.9, end: 0 },
        tint: [0xffd93d, 0xffffff],
        emitting: false,
      })
      .setDepth(DEPTH.particles)
    this.embers = this.scene.add
      .particles(0, 0, 'sl-spark', {
        speed: { min: 80, max: 260 },
        gravityY: -60,
        lifespan: 700,
        scale: { start: 1.1, end: 0 },
        tint: [0xff922b, 0xff6b6b, 0xffd93d],
        emitting: false,
      })
      .setDepth(DEPTH.particles)

    this.flash = this.scene.add
      .graphics()
      .fillStyle(0xffffff, 1)
      .fillRect(0, 0, w, h)
      .setDepth(DEPTH.flash)
      .setAlpha(0)
  }

  // ─── Receive (star arrives) ────────────────────────────────────────────────

  private playReceive(): void {
    this.phase = 'receiving'
    this.scene.tweens.add({ targets: this.scrim, alpha: 0.74, duration: 320, ease: 'Quad.easeOut' })
    this.scene.tweens.add({ targets: this.wash, alpha: 0.92, duration: 420, ease: 'Quad.easeOut' })
    this.scene.tweens.add({ targets: this.halo, alpha: 0.55, duration: 500, ease: 'Quad.easeOut' })
    playTone(100, 240, 'sine', 0.12) // deep bass thump
    this.delay(120, () => playTone(150, 160, 'sine', 0.07))
    this.scene.tweens.add({
      targets: this.starWrap,
      scale: 1,
      duration: 620,
      delay: 140,
      ease: 'Back.easeOut',
      onComplete: () => this.enterIdle(),
    })
  }

  // ─── Idle loop (invite taps) ───────────────────────────────────────────────

  private enterIdle(): void {
    this.phase = 'idle'
    // Halo pulse.
    this.scene.tweens.add({
      targets: this.halo,
      scale: { from: 1, to: 1.14 },
      alpha: { from: 0.5, to: 0.68 },
      duration: 950,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    // Gentle bob.
    this.scene.tweens.add({
      targets: this.starWrap,
      y: this.cy - this.R * 0.06,
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.scheduleBlink()
    this.scheduleWiggle()
    this.scheduleSparkle()
  }

  private scheduleBlink(): void {
    this.delay(2000 + Math.random() * 2000, () => {
      if (this.phase !== 'idle') {
        this.scheduleBlink()
        return
      }
      this.scene.tweens.add({
        targets: [this.eyeL, this.eyeR],
        scaleY: 0.12,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeInOut',
      })
      this.scheduleBlink()
    })
  }

  private scheduleWiggle(): void {
    this.delay(2600 + Math.random() * 1400, () => {
      if (this.phase !== 'idle') {
        this.scheduleWiggle()
        return
      }
      this.scene.tweens.add({
        targets: this.starWrap,
        angle: { from: -7, to: 7 },
        duration: 90,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
        onComplete: () => this.starWrap.setAngle(0),
      })
      playTone(660, 70, 'triangle', 0.03)
      this.scheduleWiggle()
    })
  }

  private scheduleSparkle(): void {
    this.delay(500 + Math.random() * 400, () => {
      if (this.phase === 'idle') {
        const a = Math.random() * Math.PI * 2
        const d = this.R * (0.9 + Math.random() * 0.5)
        this.sparkles.explode(
          2,
          this.starWrap.x + Math.cos(a) * d,
          this.starWrap.y + Math.sin(a) * d,
        )
      }
      if (this.phase !== 'done') this.scheduleSparkle()
    })
  }

  // ─── Tap handling ──────────────────────────────────────────────────────────

  private onPointerDown = (): void => {
    // Whole screen is the target; ignore taps unless the star is idle & waiting.
    if (this.phase !== 'idle') return
    const event = this.script[this.scriptIndex]
    this.scriptIndex++
    this.phase = 'busy'
    this.playAttempt(() => this.resolve(event))
  }

  /** Shared build-up: whiteout + expanding ring + suspense hold. */
  private playAttempt(then: () => void): void {
    this.scene.tweens.add({
      targets: this.starGlow,
      alpha: { from: 0, to: 0.95 },
      duration: 160,
      ease: 'Quad.easeOut',
    })
    this.ring
      .setPosition(this.starWrap.x, this.starWrap.y)
      .setAlpha(0.95)
      .setDisplaySize(this.R, this.R)
    this.scene.tweens.add({
      targets: this.ring,
      displayWidth: this.R * 3.4,
      displayHeight: this.R * 3.4,
      alpha: 0,
      duration: 460,
      ease: 'Quad.easeOut',
    })
    this.sparkles.explode(10, this.starWrap.x, this.starWrap.y)
    playTone(1300, 120, 'triangle', 0.04) // high shimmer
    this.delay(380, then)
  }

  private resolve(event: StarTapEvent): void {
    if (event === 'upgrade') this.playUpgrade()
    else if (event === 'fakeout') this.playFakeout()
    else this.playOpen()
  }

  private fadeStarGlow(): void {
    this.scene.tweens.add({ targets: this.starGlow, alpha: 0, duration: 260, ease: 'Quad.easeOut' })
  }

  // ─── Upgrade (tier + 1) ────────────────────────────────────────────────────

  private playUpgrade(): void {
    const from = tierWash(this.currentTier())
    this.tierIdx = Math.min(STAR_DROP_TIERS.length - 1, this.tierIdx + 1)
    const tier = this.currentTier()
    const to = tierWash(tier)
    const gold = tier === 'yellow'

    // Full-screen white flash (bigger for gold).
    this.flashScreen(gold ? 0.92 : 0.7, gold ? 520 : 380)
    this.fadeStarGlow()

    // Quick celebratory spin.
    this.scene.tweens.add({
      targets: this.starWrap,
      angle: '+=360',
      scale: { from: 1.18, to: 1 },
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => this.starWrap.setAngle(0),
    })

    // Background crossfades to the new tier.
    this.crossfadeWash(from, to, 260)

    // Ascending chime + bass thump.
    ;[900, 1400, 2100].forEach((f, i) =>
      this.delay(i * 70, () => playTone(f, 160, 'triangle', 0.09)),
    )
    playTone(90, 190, 'sine', 0.1)

    // Higher tiers get richer flourishes.
    if (tier === 'red') {
      this.embers.explode(24, this.starWrap.x, this.starWrap.y)
    }
    if (gold) {
      this.showRays(0xffe38a, 0.5, 900)
      this.confetti.explode(20, this.cx, this.cy - this.R)
    }

    this.delay(gold ? 780 : 640, () => this.backToIdle())
  }

  // ─── Fakeout (dramatic fizzle) ─────────────────────────────────────────────

  private playFakeout(): void {
    // Identical whiteout; from purple up it even throws the long rays…
    this.flashScreen(0.6, 320)
    if (this.tierIdx >= 2) this.showRays(0xffffff, 0.42, 520)

    // …then it fizzles: rays fade, star squashes and settles back.
    this.delay(300, () => {
      this.fadeStarGlow()
      this.scene.tweens.add({
        targets: this.starWrap,
        scaleY: { from: 0.82, to: 1 },
        scaleX: { from: 1.14, to: 1 },
        duration: 360,
        ease: 'Back.easeOut',
      })
      playTone(400, 180, 'sine', 0.05) // descending "wah"
      this.delay(140, () => playTone(260, 220, 'sine', 0.045))
    })

    this.delay(720, () => this.backToIdle())
  }

  private backToIdle(): void {
    if (this.phase === 'done' || this.phase === 'opening') return
    this.phase = 'idle'
  }

  // ─── Open (burst → reveal) ─────────────────────────────────────────────────

  private playOpen(): void {
    this.phase = 'opening'
    this.fadeStarGlow()
    // Closed-eyes grin as it winds up.
    this.scene.tweens.add({ targets: [this.eyeL, this.eyeR], scaleY: 0.14, duration: 160 })

    // Squash small, then zoom HUGE toward the camera.
    this.scene.tweens.add({
      targets: this.starWrap,
      scale: 0.62,
      duration: 200,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.starWrap,
          scale: 6,
          alpha: 0,
          duration: 320,
          ease: 'Cubic.easeIn',
        })
      },
    })

    // Rising sweep → bright pop.
    ;[280, 360, 440, 530].forEach((f, i) => this.delay(i * 55, () => playTone(f, 90, 'sine', 0.07)))
    this.delay(430, () => playTone(1600, 120, 'triangle', 0.08))

    // White burst covers the screen at the zoom peak, then reveals the reward.
    this.delay(430, () => {
      this.flash.setAlpha(0)
      this.scene.tweens.add({ targets: this.flash, alpha: 1, duration: 220, ease: 'Quad.easeOut' })
      this.delay(200, () => this.reveal())
    })
  }

  private reveal(): void {
    this.starWrap.setVisible(false)

    // Reward bird, big and centered, with rays + confetti behind/around it.
    const rPx = Math.min(this.scene.scale.width, this.scene.scale.height) * 0.16
    this.rewardBird = this.deps
      .makeBirdImage(rPx)
      .setPosition(this.cx, this.cy)
      .setDepth(DEPTH.reward)
    this.rewardBird.setScale(0)
    this.scene.tweens.add({
      targets: this.rewardBird,
      scale: 1,
      duration: 520,
      ease: 'Back.easeOut',
    })

    this.showRays(this.deps.birdColor, 0.6, 4000)
    this.scene.tweens.add({
      targets: this.rays,
      angle: '+=90',
      duration: 4000,
      ease: 'Linear',
    })

    // Fade the white burst out to reveal the bird.
    this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 480, ease: 'Quad.easeIn' })

    this.confetti.explode(28, this.cx, this.cy - this.R)
    this.delay(260, () => this.confetti.explode(20, this.cx * 0.6, this.cy))
    this.delay(260, () => this.confetti.explode(20, this.cx * 1.4, this.cy))

    // Happy arpeggio, richer/higher with tier.
    const factor = 1 + this.tierIdx * 0.05
    const notes = [523, 659, 784, 988, 1319]
    if (this.tierIdx >= 3) notes.push(1568, 1976)
    notes.forEach((f, i) =>
      this.delay(120 + i * 110, () => playTone(f * factor, 180, 'triangle', 0.09)),
    )

    // Hold, then fade everything and hand back to the scene.
    const hold = 1100 + this.tierIdx * 120
    this.delay(hold, () => {
      const all = [this.scrim, this.wash, this.halo, this.rays, this.rewardBird].filter(
        Boolean,
      ) as Phaser.GameObjects.GameObject[]
      this.scene.tweens.add({
        targets: all,
        alpha: 0,
        duration: 420,
        ease: 'Quad.easeIn',
        onComplete: () => {
          this.phase = 'done'
          this.deps.onComplete(this.deps.target)
        },
      })
    })
  }

  // ─── Small shared effects ──────────────────────────────────────────────────

  private flashScreen(peak: number, duration: number): void {
    this.flash.setAlpha(0)
    this.scene.tweens.add({
      targets: this.flash,
      alpha: { from: 0, to: peak },
      duration: duration * 0.32,
      yoyo: true,
      hold: duration * 0.12,
      ease: 'Quad.easeOut',
    })
  }

  private showRays(tint: number, peakAlpha: number, spin: number): void {
    this.rays.setTint(tint).setAlpha(0)
    this.scene.tweens.add({
      targets: this.rays,
      alpha: { from: 0, to: peakAlpha },
      duration: 260,
      yoyo: spin < 1000,
      hold: 120,
      ease: 'Quad.easeOut',
    })
    this.scene.tweens.add({ targets: this.rays, angle: '+=40', duration: spin, ease: 'Linear' })
  }

  private crossfadeWash(from: number, to: number, duration: number): void {
    const cf = Phaser.Display.Color.ValueToColor(from)
    const ct = Phaser.Display.Color.ValueToColor(to)
    const proxy = { t: 0 }
    this.scene.tweens.add({
      targets: proxy,
      t: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const col = Phaser.Display.Color.Interpolate.ColorWithColor(cf, ct, 100, proxy.t * 100)
        this.wash.setTint((col.r << 16) | (col.g << 8) | col.b)
      },
      onComplete: () => this.wash.setTint(to),
    })
  }
}

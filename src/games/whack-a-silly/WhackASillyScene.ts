import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { CRITTERS, GRID_SIZE, HOLE_COUNT, gapMs, isConfettiBop, planSpawn } from './logic'
import type { CritterSpawn, RampState } from './logic'

// ART SPEC palette — garden scene.
const SKY_TOP = 0xbde3ff
const SKY_BOTTOM = 0xe8f6ff
const GRASS_TOP = 0x8fd14f
const GRASS_BOTTOM = 0x6bcb77
const MOUND = 0xb08968
const MOUND_DARK = 0xa0785a
const HOLE_INTERIOR = 0x8c6a4f
const GOLD = 0xffd93d
const PINK = 0xff8fab
const CONFETTI_TINTS = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff8fab, 0x9b5de5]
const DIRT_TINTS = [0xb08968, 0xa0785a, 0x8c6a4f]

// Pentatonic-ish happy tones (C5 E5 G5) + C6 for big moments.
const ARPEGGIO = [523, 659, 784]
const FANFARE = [523, 659, 784, 1047]

const CRITTER_CSS = 72 // emoji strike stays crisp at ≤80 css px
// Mound texture geometry, in css px. The hole ellipse (≥110 css wide) is
// centered at (MOUND_W/2, HOLE_CY) inside the texture.
const MOUND_W = 220
const MOUND_H = 130
const HOLE_CY = 60
const HOLE_RX = 75

interface Hole {
  index: number
  /** World position of the hole opening's center. */
  x: number
  y: number
  mound: Phaser.GameObjects.Image
  critter: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Image
  hat: Phaser.GameObjects.Image
  glow: Phaser.GameObjects.Image
  maskGfx: Phaser.GameObjects.Graphics
  state: 'down' | 'rising' | 'up' | 'leaving'
  spawn: CritterSpawn | null
  upTimer: Phaser.Time.TimerEvent | null
}

export default class WhackASillyScene extends Phaser.Scene {
  private dpr = 1
  private moundScale = 1

  private startTime = 0
  private bops = 0
  private lastHole: number | null = null
  private activeCritters = 0
  private spawnTimer: Phaser.Time.TimerEvent | null = null

  private bgGfx!: Phaser.GameObjects.Graphics
  private holes: Hole[] = []
  private sun!: Phaser.GameObjects.Image
  private flowers: Phaser.GameObjects.Image[] = []
  private butterfly!: Phaser.GameObjects.Image

  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private stars!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private poofs!: Phaser.GameObjects.Particles.ParticleEmitter

  constructor() {
    super('whack-a-silly')
  }

  private px(css: number): number {
    return css * this.dpr
  }

  create(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.makeTextures()

    this.bgGfx = this.add.graphics().setDepth(0)
    this.buildScenery()
    this.buildHoles()
    this.buildEmitters()
    this.wireBackgroundTaps()
    this.layout()

    window.addEventListener('resize', this.handleWindowResize)
    window.addEventListener('orientationchange', this.handleWindowResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('resize', this.handleWindowResize)
      window.removeEventListener('orientationchange', this.handleWindowResize)
      this.spawnTimer?.remove(false)
      for (const hole of this.holes) hole.upTimer?.remove(false)
    })

    this.startTime = this.time.now
    this.flyButterfly()
    this.scheduleNext(700)
  }

  private handleWindowResize = (): void => {
    const w = Math.max(window.innerWidth, 1) * this.dpr
    const h = Math.max(window.innerHeight, 1) * this.dpr
    this.scale.resize(w, h)
    this.resetAllCritters()
    this.layout()
    this.scheduleNext(600)
  }

  // ─── Textures ────────────────────────────────────────────────────────────

  /** Pre-render an emoji to a CanvasTexture at physical pixels (crisp on retina). */
  private emojiTexture(key: string, emoji: string, cssSize: number): void {
    if (this.textures.exists(key)) return
    const fontPx = Math.round(cssSize * this.dpr)
    const pad = Math.ceil(fontPx * 0.25) // emoji overflow the em box; don't trust measureText
    const side = fontPx + pad * 2
    const tex = this.textures.createCanvas(key, side, side)
    if (!tex) return
    const ctx = tex.getContext()
    ctx.font = `${fontPx}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(emoji, side / 2, side / 2 + fontPx * 0.03)
    tex.refresh() // required for the WebGL upload
  }

  private makeTextures(): void {
    for (const critter of CRITTERS) {
      this.emojiTexture(`was-critter-${critter.id}`, critter.emoji, CRITTER_CSS)
    }
    this.emojiTexture('was-star', '⭐', 26)
    this.emojiTexture('was-sun', '☀️', 56)
    this.emojiTexture('was-flower-0', '🌼', 44)
    this.emojiTexture('was-flower-1', '🌷', 44)
    this.emojiTexture('was-flower-2', '🌻', 44)
    this.emojiTexture('was-butterfly', '🦋', 40)

    // Dirt mound with the hole opening: flat fill + one same-hue darker patch.
    if (!this.textures.exists('was-mound')) {
      const g = this.add.graphics()
      g.fillStyle(MOUND, 1)
      g.fillEllipse(this.px(110), this.px(80), this.px(210), this.px(96))
      g.fillStyle(MOUND_DARK, 1)
      g.fillEllipse(this.px(78), this.px(104), this.px(110), this.px(30))
      g.fillStyle(HOLE_INTERIOR, 1)
      g.fillEllipse(this.px(110), this.px(HOLE_CY), this.px(HOLE_RX * 2), this.px(52))
      g.generateTexture('was-mound', this.px(MOUND_W), this.px(MOUND_H))
      g.destroy()
    }

    // Party hat (NO-GO marker): pink triangle, yellow dots, pom-pom on top.
    if (!this.textures.exists('was-hat')) {
      const g = this.add.graphics()
      g.fillStyle(PINK, 1)
      g.fillTriangle(this.px(23), this.px(10), this.px(3), this.px(48), this.px(43), this.px(48))
      g.fillStyle(GOLD, 1)
      g.fillCircle(this.px(23), this.px(27), this.px(4))
      g.fillCircle(this.px(16), this.px(40), this.px(4))
      g.fillCircle(this.px(30), this.px(40), this.px(4))
      g.fillCircle(this.px(23), this.px(8), this.px(7))
      g.generateTexture('was-hat', this.px(46), this.px(52))
      g.destroy()
    }

    // Soft golden halo behind the rare golden critter.
    if (!this.textures.exists('was-glow')) {
      const g = this.add.graphics()
      for (const [radius, alpha] of [
        [58, 0.14],
        [46, 0.16],
        [34, 0.18],
        [22, 0.2],
      ]) {
        g.fillStyle(GOLD, alpha)
        g.fillCircle(this.px(60), this.px(60), this.px(radius))
      }
      g.generateTexture('was-glow', this.px(120), this.px(120))
      g.destroy()
    }

    if (!this.textures.exists('was-dot')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(this.px(6), this.px(6), this.px(6))
      g.generateTexture('was-dot', this.px(12), this.px(12))
      g.destroy()
    }
    if (!this.textures.exists('was-confetti')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillRoundedRect(0, 0, this.px(12), this.px(9), this.px(3))
      g.generateTexture('was-confetti', this.px(12), this.px(9))
      g.destroy()
    }
  }

  // ─── Build ───────────────────────────────────────────────────────────────

  private buildScenery(): void {
    // Sun (easter egg: tap → spin + chime).
    this.sun = this.add.image(0, 0, 'was-sun').setDepth(1)
    this.sun.setInteractive()
    this.sun.on('pointerdown', () => {
      playTone(784, 80, 'triangle', 0.07)
      this.time.delayedCall(110, () => playTone(1047, 120, 'triangle', 0.08))
      this.sparkles.explode(10, this.sun.x, this.sun.y)
      this.tweens.killTweensOf(this.sun)
      this.tweens.add({
        targets: this.sun,
        angle: this.sun.angle + 360,
        duration: 700,
        ease: 'Back.easeOut',
      })
    })
    this.tweens.add({
      targets: this.sun,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // Flowers on the grass — everything responds to taps.
    for (let i = 0; i < 3; i++) {
      const flower = this.add.image(0, 0, `was-flower-${i}`).setDepth(2)
      flower.setInteractive()
      flower.on('pointerdown', () => {
        playTone(659, 45, 'sine', 0.04)
        this.tweens.killTweensOf(flower)
        this.tweens.add({
          targets: flower,
          angle: { from: -12, to: 12 },
          duration: 90,
          yoyo: true,
          repeat: 2,
          ease: 'Sine.easeInOut',
          onComplete: () => flower.setAngle(0),
        })
      })
      this.flowers.push(flower)
    }

    // Butterfly drifts around the sky; tapping it makes it dart away.
    this.butterfly = this.add.image(0, 0, 'was-butterfly').setDepth(20)
    this.butterfly.setInteractive(
      new Phaser.Geom.Circle(
        this.textures.getFrame('was-butterfly').width / 2,
        this.textures.getFrame('was-butterfly').height / 2,
        this.px(45),
      ),
      Phaser.Geom.Circle.Contains,
    )
    this.butterfly.on('pointerdown', () => {
      playTone(880, 40, 'sine', 0.05)
      this.time.delayedCall(60, () => playTone(988, 50, 'sine', 0.05))
      this.sparkles.explode(6, this.butterfly.x, this.butterfly.y)
      this.flyButterfly(320)
    })
  }

  private buildHoles(): void {
    const frame = this.textures.getFrame('was-critter-hamster')
    for (let i = 0; i < HOLE_COUNT; i++) {
      const row = Math.floor(i / GRID_SIZE)

      const mound = this.add.image(0, 0, 'was-mound').setDepth(3 + row * 2)
      mound.setInteractive()
      mound.on('pointerdown', () => {
        playTone(659, 45, 'sine', 0.04)
        this.tweens.killTweensOf(mound)
        this.tweens.add({
          targets: mound,
          scaleX: { from: this.moundScale * 1.06, to: this.moundScale },
          scaleY: { from: this.moundScale * 0.94, to: this.moundScale },
          duration: 220,
          ease: 'Back.easeOut',
        })
      })

      const glow = this.add.image(0, -this.px(6), 'was-glow').setVisible(false)
      const body = this.add.image(0, 0, 'was-critter-hamster')
      const hat = this.add.image(0, -this.px(40), 'was-hat').setVisible(false).setAngle(8)
      const critter = this.add.container(0, 0, [glow, body, hat]).setDepth(4 + row * 2)

      // Critters emerge from inside the hole: everything below the hole rim
      // is masked out, so they rise into view instead of teleporting.
      const maskGfx = this.add.graphics().setVisible(false)
      critter.setMask(maskGfx.createGeometryMask())

      // Generous hit target (~120 css px circle), covering head + hat.
      body.setInteractive(
        new Phaser.Geom.Circle(frame.width / 2, frame.height / 2 - this.px(8), this.px(60)),
        Phaser.Geom.Circle.Contains,
      )
      body.disableInteractive()

      const hole: Hole = {
        index: i,
        x: 0,
        y: 0,
        mound,
        critter,
        body,
        hat,
        glow,
        maskGfx,
        state: 'down',
        spawn: null,
        upTimer: null,
      }
      body.on('pointerdown', () => this.onCritterTap(hole))
      this.holes.push(hole)
    }
  }

  private buildEmitters(): void {
    this.confetti = this.add.particles(0, 0, 'was-confetti', {
      speed: { min: this.px(200), max: this.px(400) },
      angle: { min: 240, max: 300 },
      gravityY: this.px(700),
      lifespan: { min: 1500, max: 2400 },
      scale: { start: 1, end: 0 },
      rotate: { start: 0, end: 360 },
      tint: CONFETTI_TINTS,
      emitting: false,
    })
    this.stars = this.add.particles(0, 0, 'was-star', {
      speed: { min: this.px(150), max: this.px(320) },
      angle: { min: 230, max: 310 },
      gravityY: this.px(500),
      lifespan: { min: 1400, max: 2200 },
      scale: { start: 1, end: 0.2 },
      rotate: { start: 0, end: 180 },
      emitting: false,
    })
    this.sparkles = this.add.particles(0, 0, 'was-dot', {
      speed: { min: this.px(80), max: this.px(220) },
      lifespan: 450,
      scale: { start: 0.9, end: 0 },
      tint: [0xffd93d, 0xffffff, 0xff8fab],
      emitting: false,
    })
    // Dirt poof when a critter gets bopped back into its hole.
    this.poofs = this.add.particles(0, 0, 'was-dot', {
      speed: { min: this.px(60), max: this.px(190) },
      angle: { min: 220, max: 320 },
      lifespan: 500,
      alpha: { start: 0.85, end: 0 },
      scale: { start: 1.1, end: 2.2 },
      tint: DIRT_TINTS,
      emitting: false,
    })
    for (const emitter of [this.confetti, this.stars, this.sparkles, this.poofs]) {
      emitter.setDepth(50)
    }
  }

  private wireBackgroundTaps(): void {
    // Taps on empty sky/grass sparkle + boop — everything responds.
    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length > 0) return
        this.sparkles.explode(6, pointer.worldX, pointer.worldY)
        playTone(659, 45, 'sine', 0.04)
      },
    )
  }

  // ─── Layout (RESIZE-safe for portrait + landscape) ───────────────────────

  private layout(): void {
    const w = this.scale.width
    const h = this.scale.height
    const skyH = h * 0.4
    const grassH = h - skyH

    this.bgGfx.clear()
    this.bgGfx.fillGradientStyle(SKY_TOP, SKY_TOP, SKY_BOTTOM, SKY_BOTTOM, 1)
    this.bgGfx.fillRect(0, 0, w, skyH)
    this.bgGfx.fillGradientStyle(GRASS_TOP, GRASS_TOP, GRASS_BOTTOM, GRASS_BOTTOM, 1)
    this.bgGfx.fillRect(0, skyH, w, grassH)

    // Mound scale: fit 3 columns/rows with generous spacing, but never let
    // the hole opening shrink below ~110 css px (touch-target floor).
    const target = Math.min(w * 0.28, grassH * 0.44, this.px(250))
    this.moundScale = Math.max(target / this.px(MOUND_W), 110 / (HOLE_RX * 2))
    const s = this.moundScale

    const cols = [0.2, 0.5, 0.8]
    const rows = [0.24, 0.54, 0.84]
    for (const hole of this.holes) {
      const cx = w * cols[hole.index % GRID_SIZE]
      const cy = skyH + grassH * rows[Math.floor(hole.index / GRID_SIZE)]
      hole.x = cx
      hole.y = cy
      // The hole ellipse sits px(5) above the mound texture's center.
      hole.mound.setPosition(cx, cy + this.px(5) * s)
      hole.mound.setScale(s)
      hole.maskGfx.clear()
      hole.maskGfx.fillStyle(0xffffff, 1)
      hole.maskGfx.fillRect(cx - this.px(85), cy - this.px(230), this.px(170), this.px(230))
      if (hole.state === 'down') hole.critter.setPosition(cx, this.downY(hole))
    }

    // Top-right: the GameFrame home button lives top-left.
    this.sun.setPosition(w - this.px(64), this.px(64))
    this.flowers[0].setPosition(w * 0.07, skyH + grassH * 0.39)
    this.flowers[1].setPosition(w * 0.93, skyH + grassH * 0.69)
    this.flowers[2].setPosition(w * 0.35, skyH + grassH * 0.96)
    this.butterfly.setPosition(
      Phaser.Math.Clamp(this.butterfly.x, this.px(30), w - this.px(30)),
      Phaser.Math.Clamp(this.butterfly.y, this.px(30), skyH),
    )
  }

  private downY(hole: Hole): number {
    return hole.y + this.px(140)
  }

  private upY(hole: Hole, peek: boolean): number {
    return hole.y - (peek ? this.px(24) : this.px(48))
  }

  // ─── Spawning (Phaser timers, never setInterval) ─────────────────────────

  private rampState(): RampState {
    return { elapsedMs: this.time.now - this.startTime, bops: this.bops }
  }

  private scheduleNext(delay: number): void {
    this.spawnTimer?.remove(false)
    this.spawnTimer = this.time.delayedCall(delay, () => this.spawnWave())
  }

  private spawnWave(): void {
    const state = this.rampState()
    const occupied = this.holes.filter((h) => h.state !== 'down').map((h) => h.index)
    const plan = planSpawn(state, occupied, this.lastHole, Math.random)
    this.popCritter(this.holes[plan.primary.hole], plan.primary, plan.upTimeMs)
    if (plan.double) this.popCritter(this.holes[plan.double.hole], plan.double, plan.upTimeMs)
    this.lastHole = plan.primary.hole
  }

  private popCritter(hole: Hole, spawn: CritterSpawn, upTime: number): void {
    if (hole.state !== 'down') return
    hole.spawn = spawn
    hole.state = 'rising'
    this.activeCritters++

    hole.body.setTexture(`was-critter-${spawn.critterId}`)
    if (spawn.golden) {
      hole.body.setTint(GOLD)
      hole.glow.setVisible(true)
      this.sparkles.explode(10, hole.x, hole.y - this.px(30))
    } else {
      hole.body.clearTint()
      hole.glow.setVisible(false)
    }
    hole.hat.setVisible(spawn.hat)
    hole.body.setInteractive()

    const peekDir = Math.random() < 0.5 ? -1 : 1
    hole.critter.setPosition(hole.x + (spawn.peek ? peekDir * this.px(26) : 0), this.downY(hole))
    hole.critter.setScale(1).setAlpha(1)
    hole.critter.setAngle(spawn.peek ? peekDir * 16 : 0)

    playTone(523, 40, 'sine', 0.03)
    this.tweens.add({
      targets: hole.critter,
      y: this.upY(hole, spawn.peek),
      duration: 280,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (hole.state !== 'rising') return
        hole.state = 'up'
        hole.upTimer = this.time.delayedCall(upTime, () => this.expire(hole))
      },
    })
  }

  /** A critter is done (bopped, dizzy, or expired) — schedule the next pop. */
  private onCritterGone(): void {
    this.activeCritters = Math.max(this.activeCritters - 1, 0)
    if (this.activeCritters === 0) this.scheduleNext(gapMs(this.rampState()))
  }

  /** Duck back into the hole, then reset for reuse. */
  private descend(hole: Hole, duration: number): void {
    this.tweens.add({
      targets: hole.critter,
      y: this.downY(hole),
      duration,
      ease: 'Quad.easeIn',
      onComplete: () => this.resetHole(hole),
    })
  }

  private resetHole(hole: Hole): void {
    hole.state = 'down'
    hole.spawn = null
    hole.critter.setPosition(hole.x, this.downY(hole))
    hole.critter.setScale(1).setAlpha(1).setAngle(0)
    hole.body.disableInteractive()
    hole.glow.setVisible(false)
    hole.hat.setVisible(false)
  }

  private resetAllCritters(): void {
    this.spawnTimer?.remove(false)
    this.spawnTimer = null
    for (const hole of this.holes) {
      hole.upTimer?.remove(false)
      hole.upTimer = null
      this.tweens.killTweensOf(hole.critter)
      this.resetHole(hole)
    }
    this.activeCritters = 0
  }

  private stopCritterClock(hole: Hole): void {
    hole.upTimer?.remove(false)
    hole.upTimer = null
    this.tweens.killTweensOf(hole.critter)
  }

  // ─── Reactions ───────────────────────────────────────────────────────────

  private onCritterTap(hole: Hole): void {
    if (hole.state !== 'rising' && hole.state !== 'up') return
    if (hole.spawn?.hat) this.dizzy(hole)
    else this.bop(hole)
  }

  /** GO critter bopped: squash flat + dirt poof + descending boing → sinks. */
  private bop(hole: Hole): void {
    const golden = hole.spawn?.golden ?? false
    hole.state = 'leaving'
    this.stopCritterClock(hole)
    this.bops++

    playTone(587, 70, 'square', 0.08)
    this.time.delayedCall(70, () => playTone(294, 130, 'square', 0.06))
    this.poofs.explode(12, hole.x, hole.y)

    this.tweens.add({
      targets: hole.critter,
      scaleX: 1.35,
      scaleY: 0.3,
      duration: 90,
      ease: 'Quad.easeOut',
      onComplete: () => this.descend(hole, 140),
    })

    if (golden) this.goldenCelebration(hole)
    else if (isConfettiBop(this.bops)) this.miniCelebration(hole)
    this.onCritterGone()
  }

  /**
   * NO-GO (hat) critter bopped — soft, funny, zero punishment: dizzy wobble,
   * stars circling its head, giggle two-tone, and it just ducks back down.
   */
  private dizzy(hole: Hole): void {
    hole.state = 'leaving'
    this.stopCritterClock(hole)

    playTone(784, 55, 'sine', 0.06)
    this.time.delayedCall(80, () => playTone(880, 60, 'sine', 0.06))
    this.time.delayedCall(240, () => playTone(262, 130, 'sine', 0.05))
    this.orbitStars(hole)

    this.tweens.add({
      targets: hole.critter,
      angle: { from: -14, to: 14 },
      duration: 80,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        hole.critter.setAngle(0)
        this.descend(hole, 180)
      },
    })
    this.onCritterGone()
  }

  /** Up-time over. Hat critter left in peace gets celebrated for it. */
  private expire(hole: Hole): void {
    if (hole.state !== 'up') return
    hole.state = 'leaving'
    hole.upTimer = null

    if (hole.spawn?.hat) {
      // Withholding the tap is the win: wave + sparkle + happy chime.
      playTone(659, 90, 'triangle', 0.08)
      this.time.delayedCall(120, () => playTone(988, 140, 'triangle', 0.09))
      this.sparkles.explode(12, hole.critter.x, hole.critter.y - this.px(30))
      this.tweens.add({
        targets: hole.critter,
        angle: { from: -8, to: 8 },
        duration: 110,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          hole.critter.setAngle(0)
          this.descend(hole, 200)
        },
      })
    } else {
      this.descend(hole, 220)
    }
    this.onCritterGone()
  }

  /** Three stars circle the dizzy critter's head, then fade. */
  private orbitStars(hole: Hole): void {
    const cx = hole.critter.x
    const cy = hole.critter.y - this.px(34)
    const radius = this.px(38)
    const orbiters = [0, 1, 2].map(() =>
      this.add.image(cx, cy, 'was-star').setDepth(51).setScale(0.8),
    )
    const spin = { t: 0 }
    this.tweens.add({
      targets: spin,
      t: 1,
      duration: 750,
      ease: 'Linear',
      onUpdate: () => {
        orbiters.forEach((star, i) => {
          const angle = spin.t * Math.PI * 3 + (i * Math.PI * 2) / 3
          star.setPosition(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.45)
          star.setAlpha(spin.t < 0.7 ? 1 : 1 - (spin.t - 0.7) / 0.3)
        })
      },
      onComplete: () => {
        for (const star of orbiters) star.destroy()
      },
    })
  }

  /** Every ~10 bops: quick confetti that never pauses spawning. */
  private miniCelebration(hole: Hole): void {
    this.confetti.explode(40, hole.x, hole.y - this.px(60))
    ARPEGGIO.forEach((freq, i) =>
      this.time.delayedCall(i * 120, () => playTone(freq, 150, 'triangle', 0.09)),
    )
  }

  /** Golden critter bopped: rainbow confetti + star shower + fanfare. */
  private goldenCelebration(hole: Hole): void {
    this.confetti.explode(70, hole.x, hole.y - this.px(60))
    this.confetti.explode(30, this.scale.width * 0.25, this.px(90))
    this.confetti.explode(30, this.scale.width * 0.75, this.px(90))
    this.stars.explode(10, hole.x, hole.y - this.px(60))
    FANFARE.forEach((freq, i) =>
      this.time.delayedCall(i * 110, () => playTone(freq, 160, 'triangle', 0.1)),
    )
  }

  // ─── Butterfly ───────────────────────────────────────────────────────────

  private flyButterfly(dartMs?: number): void {
    const w = this.scale.width
    const skyH = this.scale.height * 0.4
    const targetX = Phaser.Math.FloatBetween(w * 0.1, w * 0.9)
    const targetY = Phaser.Math.FloatBetween(this.px(40), Math.max(skyH - this.px(20), this.px(60)))
    this.butterfly.setFlipX(targetX < this.butterfly.x)
    this.tweens.killTweensOf(this.butterfly)
    // Keep the idle wing-tilt wiggle alive alongside the flight.
    this.tweens.add({
      targets: this.butterfly,
      angle: { from: -8, to: 8 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.tweens.add({
      targets: this.butterfly,
      x: targetX,
      y: targetY,
      duration: dartMs ?? Phaser.Math.Between(2600, 4200),
      ease: dartMs ? 'Quad.easeOut' : 'Sine.easeInOut',
      onComplete: () => this.flyButterfly(),
    })
  }
}

import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { reportLevel } from '../../shared/level'
import { addStars, loadProgress, saveSkill, sessionStart } from '../../shared/progress'
import { onViewportResize, viewportSize } from '../../shared/viewport'
import {
  BALLOON_COLORS,
  BALLOON_SHAPES,
  SKILL_MAX,
  SKILL_START,
  dotPositions,
  isSkyCelebration,
  levelFor,
  pickTask,
  planBalloon,
  planInitialWave,
  planRound,
  shouldShowHint,
  updateSkill,
} from './logic'
import type { BalloonSpec, RoundPlan, SkillPair, TaskId } from './logic'

/** Registry id — also the key the shared progress store files this under. */
const GAME_ID = 'balloon-pop'

/**
 * AI-generated sprites (see .claude/skills/art-atlas-slice). Adding art =
 * dropping a PNG here; the glob picks it up and preload() registers it under
 * its `bp-*` key. Balloons are white and engine-tinted per palette color.
 */
const ART_URLS = import.meta.glob('./art/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** art/<file>.png → texture key. Balloons map by shape name below. */
const ART_KEYS: Record<string, string> = {
  'crab-body': 'bp-crab',
  'crab-claw': 'bp-claw',
  'crab-eye': 'bp-eye',
  'crab-platform': 'bp-platform',
  sun: 'bp-sun',
  'cloud-a': 'bp-cloud-0',
  'cloud-b': 'bp-cloud-1',
  'cloud-c': 'bp-cloud-2',
  sign: 'bp-sign',
}

/** Balloon body display width per shape, css px (uniform scale, ≥100 target). */
const BALLOON_WIDTH_CSS: Record<string, number> = {
  classic: 106,
  round: 112,
  wide: 122,
  squircle: 112,
  egg: 102,
  star: 128,
}

// ART SPEC palette — sky scene.
const SKY_TOP = 0x7cc6fe
const SKY_BOTTOM = 0xd6f0ff
const INK = 0x3d3a4b
const GOLD = 0xffd93d
const RAINBOW = [0xff6b6b, 0xffa94d, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x9b5de5]

// Pentatonic-ish happy tones; count-aloud beeps ascend one per dot.
const COUNT_BEEPS = [523, 587, 659, 784, 880, 988]
const FANFARE = [523, 659, 784, 1047]
const CELEBRATION_FANFARE = [523, 659, 784, 1047, 1319]

/** Gap between count-aloud beeps (one per dot). */
const COUNT_STEP_MS = 340
/** Flight time of a dot from popped balloon to the crab's sign. */
const FLY_MS = 420

/** Balloon body center offset from the slot container origin, css px. */
const BODY_OFFSET_Y = -35
/** White dot-disc radius, css. */
const DISC_R = 36
// Claw shoulder joint, css px relative to the crab's center. Claws pivot at
// their arm ROOT (origin set into the arm's end), planted on the body's upper
// sides, pincers up — so they stay attached whatever the pose or wave angle.
const CLAW_X = 48
const CLAW_Y = -26
/** Arm-root position inside the (unflipped) claw sprite, origin fractions. */
const CLAW_ROOT_X = 0.22
const CLAW_ROOT_Y = 0.82
/** How far a claw swings (degrees) during the celebration wave. */
const CLAW_WAVE = 34

interface BalloonSlot {
  root: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Image
  string: Phaser.GameObjects.Image
  glow: Phaser.GameObjects.Image
  dots: Phaser.GameObjects.Image[]
  numeral: Phaser.GameObjects.Image
  wobbleTween: Phaser.Tweens.Tween | null
  spec: BalloonSpec | null
  baseX: number
  swayPhase: number
  spawnTime: number
  state: 'idle' | 'rising' | 'popping' | 'leaving'
}

interface Cloud {
  img: Phaser.GameObjects.Image
  speedCss: number
  yFrac: number
}

function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

export default class BalloonPopScene extends Phaser.Scene {
  private dpr = 1

  private roundsCompleted = 0
  private prevTarget: number | null = null
  private round: RoundPlan | null = null
  private roundId = 0
  private roundActive = false
  private wrongTaps = 0
  private matchEscapes = 0
  private hintOn = false
  private lastColorIndex: number | null = null
  // Adaptive skill meters: nudged after every completed round (see logic.ts),
  // persisted via shared/progress.ts, plus the recent task ids so the picker
  // can enforce variety. `peak` is the best-ever saved value — while below
  // it, up-steps double (session warm-up).
  private skill: SkillPair = { motor: SKILL_START, cognitive: SKILL_START }
  private peak: SkillPair = { motor: SKILL_START, cognitive: SKILL_START }
  private recentTasks: TaskId[] = []
  private roundStartAt = 0

  private bgGfx!: Phaser.GameObjects.Graphics
  private rainbowGfx!: Phaser.GameObjects.Graphics
  private slots: BalloonSlot[] = []
  private clouds: Cloud[] = []
  private sun!: Phaser.GameObjects.Image

  private crabRoot!: Phaser.GameObjects.Container
  private crabEyes: Phaser.GameObjects.Image[] = []
  private crabClawLeft!: Phaser.GameObjects.Image
  private crabClawRight!: Phaser.GameObjects.Image
  // Crab-is-alive state: it leans toward the nearest balloon and its eyes
  // track it. Only crabRoot.x and the eyes' positions are driven per-frame,
  // so the clap/blink/breathing tweens (angle, scaleY, scale) never fight it.
  private crabBaseX = 0
  private crabBaseY = 0
  private crabLeanX = 0
  private crabEyeBase: { x: number; y: number }[] = []
  private crabEyeOff = { x: 0, y: 0 }
  /** Sprite eyes are display-sized; blink tweens scale relative to this. */
  private crabEyeBaseScale = 1
  private signRoot!: Phaser.GameObjects.Container
  private signNumeral!: Phaser.GameObjects.Image
  private signDots: Phaser.GameObjects.Image[] = []
  private signBlob!: Phaser.GameObjects.Image
  private signDisc!: Phaser.GameObjects.Image

  // Sign prompt geometry (css px), set by updateSign, reused by countAloud
  // so flying dots land exactly where the sign draws them.
  private signDotSpacing = 36
  private signDotOriginY = 0
  private signDotScale = 1
  private signNumeralY = 0
  private signNumeralScale = 0.95

  private stars!: Phaser.GameObjects.Particles.ParticleEmitter
  private starRain!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private shredEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = []

  private waveTimers: Phaser.Time.TimerEvent[] = []
  private beepTimers: Phaser.Time.TimerEvent[] = []
  private blinkTimer: Phaser.Time.TimerEvent | null = null

  constructor() {
    super('balloon-pop')
  }

  private px(css: number): number {
    return css * this.dpr
  }

  preload(): void {
    for (const [path, url] of Object.entries(ART_URLS)) {
      const name = path.replace('./art/', '').replace('.png', '')
      const key = ART_KEYS[name] ?? (name.startsWith('balloon-') ? `bp-${name}` : null)
      if (key) this.load.image(key, url)
    }
  }

  create(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)

    // Resume the saved skill meters a couple of steps down (warm-up ramp);
    // the peak lets updateSkill climb back at double speed.
    const saved = loadProgress(GAME_ID)
    const startOptions = { max: SKILL_MAX, lastPlayedAt: saved.lastPlayedAt }
    this.skill = {
      motor: sessionStart(saved.skill.motor ?? SKILL_START, startOptions),
      cognitive: sessionStart(saved.skill.cognitive ?? SKILL_START, startOptions),
    }
    this.peak = {
      motor: Math.max(saved.skill.motor ?? SKILL_START, this.skill.motor),
      cognitive: Math.max(saved.skill.cognitive ?? SKILL_START, this.skill.cognitive),
    }

    this.makeTextures()

    this.bgGfx = this.add.graphics().setDepth(0)
    this.rainbowGfx = this.add.graphics().setDepth(45)
    this.buildScenery()
    this.buildCrabAndSign()
    this.buildBalloons()
    this.buildEmitters()
    this.wireBackgroundTaps()
    this.layout()

    const offViewport = onViewportResize(this.handleWindowResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offViewport()
      for (const timer of this.waveTimers) timer.remove(false)
      for (const timer of this.beepTimers) timer.remove(false)
      this.blinkTimer?.remove(false)
    })
    // React unmount calls game.destroy(), which emits DESTROY (not SHUTDOWN) —
    // without this the viewport listener leaks and fires on a dead scene.
    this.events.once(Phaser.Scenes.Events.DESTROY, offViewport)

    this.scheduleBlink()
    reportLevel(levelFor(this.roundsCompleted))
    this.time.delayedCall(450, () => this.startRound())
  }

  private handleWindowResize = (): void => {
    const vp = viewportSize()
    const w = vp.width * this.dpr
    const h = vp.height * this.dpr
    if (w === this.scale.width && h === this.scale.height) return
    this.scale.resize(w, h)
    this.layout()
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

  /** Big friendly numeral (numerals are fine for pre-readers, words are not). */
  private numeralTexture(key: string, digit: number, cssSize: number): void {
    if (this.textures.exists(key)) return
    const fontPx = Math.round(cssSize * this.dpr)
    const pad = Math.ceil(fontPx * 0.2)
    const side = fontPx + pad * 2
    const tex = this.textures.createCanvas(key, side, side)
    if (!tex) return
    const ctx = tex.getContext()
    ctx.font = `900 ${fontPx}px "Arial Rounded MT Bold", "Helvetica Neue", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#3D3A4B'
    ctx.fillText(String(digit), side / 2, side / 2 + fontPx * 0.04)
    tex.refresh()
  }

  /**
   * Procedural textures for everything NOT covered by the AI sprite atlas:
   * the teaching surfaces (disc, ink dots, numerals) stay code-drawn for
   * legibility, plus particles, the hint glow and the balloon string.
   */
  private makeTextures(): void {
    for (let n = 1; n <= 6; n++) this.numeralTexture(`bp-num-${n}`, n, 64)
    this.emojiTexture('bp-star', '⭐', 26)

    // Wavy white string hanging under a balloon (sprites carry only a knot).
    if (!this.textures.exists('bp-string')) {
      const g = this.add.graphics()
      g.lineStyle(this.px(3), 0xffffff, 0.9)
      g.beginPath()
      g.moveTo(this.px(10), 0)
      for (let i = 1; i <= 16; i++) {
        const t = i / 16
        g.lineTo(this.px(10 + Math.sin(t * Math.PI * 2.2) * 7), this.px(t * 58))
      }
      g.strokePath()
      g.generateTexture('bp-string', this.px(20), this.px(60))
      g.destroy()
    }

    // White disc that carries the ink dots (dots stay ink-on-white for legibility).
    if (!this.textures.exists('bp-disc')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(this.px(DISC_R + 2), this.px(DISC_R + 2), this.px(DISC_R))
      g.lineStyle(this.px(2), INK, 0.15)
      g.strokeCircle(this.px(DISC_R + 2), this.px(DISC_R + 2), this.px(DISC_R))
      g.generateTexture('bp-disc', this.px(DISC_R * 2 + 4), this.px(DISC_R * 2 + 4))
      g.destroy()
    }

    if (!this.textures.exists('bp-ink-dot')) {
      const g = this.add.graphics()
      g.fillStyle(INK, 1)
      g.fillCircle(this.px(7), this.px(7), this.px(7))
      g.generateTexture('bp-ink-dot', this.px(14), this.px(14))
      g.destroy()
    }

    // Soft golden halo for the escalating match hint.
    if (!this.textures.exists('bp-glow')) {
      const g = this.add.graphics()
      for (const [radius, alpha] of [
        [68, 0.14],
        [54, 0.16],
        [40, 0.18],
        [26, 0.2],
      ]) {
        g.fillStyle(GOLD, alpha)
        g.fillCircle(this.px(70), this.px(70), this.px(radius))
      }
      g.generateTexture('bp-glow', this.px(140), this.px(140))
      g.destroy()
    }

    if (!this.textures.exists('bp-dot')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(this.px(6), this.px(6), this.px(6))
      g.generateTexture('bp-dot', this.px(12), this.px(12))
      g.destroy()
    }
    if (!this.textures.exists('bp-shred')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillRoundedRect(0, 0, this.px(13), this.px(9), this.px(3))
      g.generateTexture('bp-shred', this.px(13), this.px(9))
      g.destroy()
    }
  }

  // ─── Build ───────────────────────────────────────────────────────────────

  private buildScenery(): void {
    // Sun top-right (top-left is the home button — keep it clear). Easter
    // egg: tap → spin + chime.
    this.sun = this.add.image(0, 0, 'bp-sun').setDepth(1)
    this.sun.setDisplaySize(this.px(92), this.px(92))
    const sunScale = this.sun.scaleX
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
    // Sprites are sized via display size, so tweens must be RELATIVE to the
    // resulting base scale — an absolute scale of 1 would blow up to the
    // sprite's intrinsic ~500px.
    this.tweens.add({
      targets: this.sun,
      scaleX: sunScale * 1.06,
      scaleY: sunScale * 1.06,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // Drifting clouds. Easter egg: tap a cloud → it puffs and rains tiny stars.
    const cloudDefs = [
      { tex: 'bp-cloud-0', widthCss: 190, yFrac: 0.3, xFrac: 0.2, speedCss: 4 },
      { tex: 'bp-cloud-1', widthCss: 150, yFrac: 0.52, xFrac: 0.68, speedCss: 6 },
      { tex: 'bp-cloud-2', widthCss: 220, yFrac: 0.7, xFrac: 0.42, speedCss: 5 },
    ]
    for (const def of cloudDefs) {
      const img = this.add.image(0, 0, def.tex).setDepth(2).setAlpha(0.9)
      img.displayWidth = this.px(def.widthCss)
      img.scaleY = img.scaleX
      const baseScale = img.scaleX
      img.setInteractive()
      img.on('pointerdown', () => {
        playTone(880, 70, 'triangle', 0.06)
        this.time.delayedCall(100, () => playTone(1175, 110, 'triangle', 0.06))
        this.starRain.explode(12, img.x, img.y + this.px(26))
        this.tweens.killTweensOf(img)
        this.tweens.add({
          targets: img,
          scaleX: baseScale * 1.12,
          scaleY: baseScale * 1.12,
          duration: 220,
          yoyo: true,
          ease: 'Back.easeOut',
          onComplete: () => img.setScale(baseScale),
        })
      })
      img.x = def.xFrac * Math.max(window.innerWidth, 1) * this.dpr
      this.clouds.push({ img, speedCss: def.speedCss, yFrac: def.yFrac })
    }
  }

  private buildCrabAndSign(): void {
    const platform = this.add.image(0, this.px(44), 'bp-platform').setAlpha(0.95)
    platform.displayWidth = this.px(170)
    platform.scaleY = platform.scaleX
    const body = this.add.image(0, 0, 'bp-crab')
    body.displayWidth = this.px(130)
    body.scaleY = body.scaleX
    // Arms raised "hooray": each claw's origin sits at its arm root, and that
    // root is planted on the body's shoulder — the sprite (pincer up-right,
    // arm to bottom-left) is flipped for the LEFT side so pincers point away
    // from the head. Drawn behind the body, which hides the joint seam.
    this.crabClawLeft = this.add
      .image(-this.px(CLAW_X), this.px(CLAW_Y), 'bp-claw')
      .setFlipX(true)
      .setOrigin(1 - CLAW_ROOT_X, CLAW_ROOT_Y)
    this.crabClawRight = this.add
      .image(this.px(CLAW_X), this.px(CLAW_Y), 'bp-claw')
      .setOrigin(CLAW_ROOT_X, CLAW_ROOT_Y)
    for (const claw of [this.crabClawLeft, this.crabClawRight]) {
      claw.displayWidth = this.px(52)
      claw.scaleY = claw.scaleX
    }
    // Stalk eyes peek over the top of the body; the stalk root stays tucked
    // behind it so small tracking offsets never detach the eye.
    const eyeLeft = this.add.image(-this.px(20), -this.px(60), 'bp-eye')
    const eyeRight = this.add.image(this.px(20), -this.px(60), 'bp-eye')
    this.crabEyes = [eyeLeft, eyeRight]
    for (const eye of this.crabEyes) {
      eye.displayHeight = this.px(42)
      eye.scaleX = eye.scaleY
    }
    this.crabEyeBaseScale = eyeLeft.scaleY
    this.crabEyeBase = [
      { x: eyeLeft.x, y: eyeLeft.y },
      { x: eyeRight.x, y: eyeRight.y },
    ]
    // Paint order inside the crab: cloud → claws (behind the body so the
    // shoulder seam is hidden) → body → eyes. The separate panel root floats
    // one depth above the whole crab.
    this.crabRoot = this.add
      .container(0, 0, [platform, this.crabClawLeft, this.crabClawRight, body, eyeLeft, eyeRight])
      .setDepth(30)

    // The crab responds too — everything responds. The hit circle lives in
    // the sprite's LOCAL (intrinsic) space, so convert the css radius by the
    // display scale.
    const bodyFrame = this.textures.getFrame('bp-crab')
    body.setInteractive(
      new Phaser.Geom.Circle(bodyFrame.width / 2, bodyFrame.height / 2, this.px(62) / body.scaleX),
      Phaser.Geom.Circle.Contains,
    )
    body.on('pointerdown', () => {
      playTone(659, 60, 'sine', 0.06)
      this.time.delayedCall(90, () => playTone(784, 80, 'sine', 0.06))
      this.tweens.add({
        targets: this.crabRoot,
        angle: { from: -5, to: 5 },
        duration: 110,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
        onComplete: () => this.crabRoot.setAngle(0),
      })
    })

    // Idle life: gentle breathing.
    this.tweens.add({
      targets: this.crabRoot,
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // Sign: wide, low white card the crab holds overhead, showing ONLY the
    // current task — dots, or a numeral, or either on a mini balloon of the
    // asked-for color.
    const signBg = this.add.image(0, 0, 'bp-sign')
    signBg.setDisplaySize(this.px(196), this.px(88))
    // The color-round mini balloon is the round white balloon sprite, tinted.
    this.signBlob = this.add.image(0, 0, 'bp-balloon-round').setVisible(false)
    this.signBlob.displayWidth = this.px(56)
    this.signBlob.scaleY = this.signBlob.scaleX
    this.signDisc = this.add.image(0, -this.px(2), 'bp-disc').setScale(0.62).setVisible(false)
    this.signNumeral = this.add.image(0, 0, 'bp-num-1').setScale(0.95)
    this.signDots = Array.from({ length: 6 }, () =>
      this.add.image(0, 0, 'bp-ink-dot').setVisible(false),
    )
    this.signRoot = this.add
      .container(0, 0, [signBg, this.signBlob, this.signDisc, this.signNumeral, ...this.signDots])
      // One above the crab (30) so it covers the raised pincer tips, but
      // BELOW the balloons (32) — balloons float in front of the whole scene.
      .setDepth(31)

    // Tapping the sign replays the count beeps.
    signBg.setInteractive()
    signBg.on('pointerdown', () => {
      if (!this.round) return
      this.tweens.add({
        targets: this.signRoot,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 140,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => this.signRoot.setScale(1),
      })
      this.playCountBeeps()
    })
  }

  private buildBalloons(): void {
    for (let i = 0; i < 4; i++) {
      const glow = this.add.image(0, this.px(BODY_OFFSET_Y), 'bp-glow').setVisible(false)
      const string = this.add.image(0, 0, 'bp-string')
      const body = this.add.image(0, this.px(BODY_OFFSET_Y), 'bp-balloon-classic')
      const disc = this.add.image(0, this.px(BODY_OFFSET_Y), 'bp-disc')
      const dots = Array.from({ length: 6 }, () =>
        this.add.image(0, this.px(BODY_OFFSET_Y), 'bp-ink-dot').setVisible(false),
      )
      const numeral = this.add
        .image(0, this.px(BODY_OFFSET_Y), 'bp-num-1')
        .setScale(0.8)
        .setVisible(false)
      const root = this.add
        .container(0, 0, [glow, string, body, disc, ...dots, numeral])
        // In FRONT of the crab (30) AND its panel (31): balloons are the
        // foreground layer and stay tappable everywhere on screen.
        .setDepth(32)
        .setVisible(false)

      // Hit shape is (re)set per spawn — each shape has its own frame size.
      body.disableInteractive()

      const slot: BalloonSlot = {
        root,
        body,
        string,
        glow,
        dots,
        numeral,
        wobbleTween: null,
        spec: null,
        baseX: 0,
        swayPhase: 0,
        spawnTime: 0,
        state: 'idle',
      }
      body.on('pointerdown', () => this.onBalloonTap(slot))
      this.slots.push(slot)
    }
  }

  private buildEmitters(): void {
    this.stars = this.add.particles(0, 0, 'bp-star', {
      speed: { min: this.px(150), max: this.px(320) },
      angle: { min: 230, max: 310 },
      gravityY: this.px(500),
      lifespan: { min: 1400, max: 2200 },
      scale: { start: 1, end: 0.2 },
      rotate: { start: 0, end: 180 },
      emitting: false,
    })
    // Tiny stars raining out of a tapped cloud.
    this.starRain = this.add.particles(0, 0, 'bp-star', {
      speed: { min: this.px(30), max: this.px(90) },
      angle: { min: 70, max: 110 },
      gravityY: this.px(220),
      lifespan: { min: 1200, max: 1800 },
      scale: { start: 0.55, end: 0.1 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    })
    this.sparkles = this.add.particles(0, 0, 'bp-dot', {
      speed: { min: this.px(80), max: this.px(220) },
      lifespan: 450,
      scale: { start: 0.9, end: 0 },
      tint: [0xffd93d, 0xffffff, 0xff8fab],
      emitting: false,
    })
    // One rubber-shred emitter per balloon color, so shreds match the pop.
    for (const hex of BALLOON_COLORS) {
      this.shredEmitters.push(
        this.add.particles(0, 0, 'bp-shred', {
          speed: { min: this.px(160), max: this.px(340) },
          gravityY: this.px(550),
          lifespan: { min: 900, max: 1400 },
          scale: { start: 1.1, end: 0 },
          rotate: { start: 0, end: 360 },
          tint: hexToInt(hex),
          emitting: false,
        }),
      )
    }
    for (const emitter of [this.stars, this.starRain, this.sparkles, ...this.shredEmitters]) {
      emitter.setDepth(50)
    }
  }

  private wireBackgroundTaps(): void {
    // Taps on empty sky sparkle + boop — everything responds.
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

    this.bgGfx.clear()
    this.bgGfx.fillGradientStyle(SKY_TOP, SKY_TOP, SKY_BOTTOM, SKY_BOTTOM, 1)
    this.bgGfx.fillRect(0, 0, w, h)
    this.rainbowGfx.clear()

    // Task panel top-center; the crab sits lower on its cloud, claws raised,
    // holding the panel overhead. crabBaseX/Y is the rest position; update()
    // leans crabRoot.x off it.
    this.crabBaseX = w / 2
    this.crabBaseY = this.px(200)
    this.crabRoot.setPosition(this.crabBaseX, this.crabBaseY)
    this.signRoot.setPosition(w / 2, this.px(72))

    // Sun top-right — the home button owns the top-left corner.
    this.sun.setPosition(w - this.px(60), this.px(60))

    for (const cloud of this.clouds) {
      cloud.img.y = h * cloud.yFrac
      const half = cloud.img.displayWidth / 2
      cloud.img.x = Phaser.Math.Clamp(cloud.img.x, -half, w + half)
    }

    for (const slot of this.slots) {
      if (!slot.spec) continue
      slot.baseX = this.balloonX(slot.spec.xFrac)
      slot.root.y = Math.min(slot.root.y, h + this.px(140))
    }
  }

  private balloonX(xFrac: number): number {
    return this.px(70) + xFrac * Math.max(this.scale.width - this.px(140), 1)
  }

  // ─── Round flow ──────────────────────────────────────────────────────────

  private startRound(): void {
    this.roundId++
    for (const timer of this.waveTimers) timer.remove(false)
    this.waveTimers = []
    this.wrongTaps = 0
    this.matchEscapes = 0
    this.hintOn = false
    this.roundActive = true
    this.round = planRound(
      {
        skill: this.skill,
        roundsCompleted: this.roundsCompleted,
        prevTarget: this.prevTarget,
        taskId: pickTask(this.skill.cognitive, this.recentTasks, Math.random),
      },
      Math.random,
    )
    this.prevTarget = this.round.target
    // Record what actually ran (the scaffold may override the picked task).
    this.recentTasks.push(this.round.taskId)
    if (this.recentTasks.length > 4) this.recentTasks.shift()
    this.roundStartAt = this.time.now

    this.updateSign()
    this.playCountBeeps()
    this.spawnWave()
  }

  /**
   * Sign shows ONLY the current task: the dot pattern alone, or the numeral
   * alone (cross rounds ask in the other representation than the balloons
   * carry), and in color rounds the prompt sits on a mini balloon tinted the
   * asked-for color.
   */
  private updateSign(): void {
    if (!this.round) return
    const { target, promptKind, targetColorIndex } = this.round
    const colorRound = targetColorIndex !== null

    this.signBlob.setVisible(colorRound)
    this.signDisc.setVisible(colorRound)
    if (targetColorIndex !== null) {
      this.signBlob.setTint(hexToInt(BALLOON_COLORS[targetColorIndex]))
    }

    // Sized for the wide, LOW panel: full-size alone on the card; shrunk
    // further onto the mini balloon's disc in color rounds.
    const centerY = colorRound ? -2 : 0
    this.signNumeralY = centerY
    this.signNumeralScale = colorRound ? 0.4 : 0.75
    this.signDotOriginY = centerY
    this.signDotSpacing = colorRound ? 16 : 26
    this.signDotScale = colorRound ? 0.55 : 0.8

    if (promptKind === 'numeral') {
      for (const dot of this.signDots) dot.setVisible(false)
      this.signNumeral
        .setTexture(`bp-num-${target}`)
        .setPosition(0, this.px(this.signNumeralY))
        .setScale(this.signNumeralScale)
        .setVisible(true)
    } else {
      this.signNumeral.setVisible(false)
      const points = dotPositions(target, 'dice')
      this.signDots.forEach((dot, i) => {
        const point = points[i]
        if (point) {
          dot
            .setPosition(
              point.x * this.px(this.signDotSpacing),
              this.px(this.signDotOriginY) + point.y * this.px(this.signDotSpacing),
            )
            .setScale(this.signDotScale)
            .setVisible(true)
        } else {
          dot.setVisible(false)
        }
      })
    }
    this.tweens.killTweensOf(this.signRoot)
    this.signRoot.setScale(0.6)
    this.tweens.add({
      targets: this.signRoot,
      scaleX: 1,
      scaleY: 1,
      duration: 420,
      ease: 'Back.easeOut',
    })
  }

  /** "Speak" the target: N ascending beeps, pulsing the sign dots along. */
  private playCountBeeps(): void {
    if (!this.round) return
    for (const timer of this.beepTimers) timer.remove(false)
    this.beepTimers = []
    const target = this.round.target
    for (let i = 0; i < target; i++) {
      this.beepTimers.push(
        this.time.delayedCall(350 + i * 320, () => {
          playTone(COUNT_BEEPS[i], 200, 'triangle', 0.09)
          this.pulseSignDot(i)
        }),
      )
    }
  }

  private pulseSignDot(index: number): void {
    const dot = this.signDots[index]
    if (!dot || !dot.visible) return
    this.tweens.killTweensOf(dot)
    dot.setScale(this.signDotScale)
    this.tweens.add({
      targets: dot,
      scaleX: this.signDotScale * 1.7,
      scaleY: this.signDotScale * 1.7,
      duration: 130,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => dot.setScale(this.signDotScale),
    })
  }

  /**
   * Opening wave: 3-4 balloons staggered from the lower half of the screen
   * so the round starts populated. planInitialWave guarantees ≥1 match.
   */
  private spawnWave(): void {
    if (!this.round) return
    const roundId = this.roundId
    const specs = planInitialWave(this.round, this.skill, Math.random, this.lastColorIndex)
    specs.forEach((spec, i) => {
      this.waveTimers.push(
        this.time.delayedCall(200 + i * 300, () => {
          if (roundId !== this.roundId || !this.roundActive) return
          const slot = this.slots.find((s) => s.spec === null)
          if (!slot) return
          const fromY = this.scale.height * (0.68 + i * 0.24)
          this.spawnBalloonInSlot(slot, spec, fromY)
        }),
      )
    })
  }

  private spawnBalloonInSlot(slot: BalloonSlot, spec: BalloonSpec, fromY?: number): void {
    slot.spec = spec
    slot.state = 'rising'
    slot.swayPhase = Math.random() * Math.PI * 2
    slot.spawnTime = this.time.now
    slot.baseX = this.balloonX(spec.xFrac)
    this.lastColorIndex = spec.colorIndex

    // White shape sprite, tinted the balloon's color (gray shading in the art
    // darkens the tint naturally).
    const shape = BALLOON_SHAPES[spec.shapeIndex]
    slot.body.setTexture(`bp-balloon-${shape}`)
    slot.body.setTint(hexToInt(BALLOON_COLORS[spec.colorIndex]))
    slot.body.displayWidth = this.px(BALLOON_WIDTH_CSS[shape] ?? 110)
    slot.body.scaleY = slot.body.scaleX
    // String hangs from the body's bottom (shapes differ in height).
    slot.string.y = this.px(BODY_OFFSET_Y) + slot.body.displayHeight / 2 + this.px(24)

    slot.root.setPosition(slot.baseX, fromY ?? this.scale.height + this.px(130))
    slot.root.setScale(1).setAlpha(1).setAngle(0).setVisible(true)
    this.applyBalloonFace(slot)
    this.setGlow(slot, this.hintOn && spec.isMatch)
    // Generous hit circle (≥130 css px across), in the frame's local space.
    const frame = slot.body.frame
    slot.body.setInteractive(
      new Phaser.Geom.Circle(frame.width / 2, frame.height / 2, this.px(66) / slot.body.scaleX),
      Phaser.Geom.Circle.Contains,
    )
  }

  /** Put the dot pattern (or numeral, late rounds) on the balloon's disc. */
  private applyBalloonFace(slot: BalloonSlot): void {
    const spec = slot.spec
    if (!spec) return
    if (spec.kind === 'numeral') {
      for (const dot of slot.dots) dot.setVisible(false)
      slot.numeral.setTexture(`bp-num-${spec.value}`).setVisible(true)
      return
    }
    slot.numeral.setVisible(false)
    const points = dotPositions(spec.value, spec.layout, Math.random)
    const dotScale = spec.value >= 5 ? 0.85 : 1
    slot.dots.forEach((dot, i) => {
      const point = points[i]
      if (point) {
        dot.setVisible(true)
        dot.setScale(dotScale)
        dot.setPosition(
          point.x * this.px(DISC_R * 0.78),
          this.px(BODY_OFFSET_Y) + point.y * this.px(DISC_R * 0.78),
        )
      } else {
        dot.setVisible(false)
      }
    })
  }

  private setGlow(slot: BalloonSlot, on: boolean): void {
    this.tweens.killTweensOf(slot.glow)
    slot.glow.setVisible(on)
    if (!on) return
    slot.glow.setAlpha(0.4).setScale(1)
    this.tweens.add({
      targets: slot.glow,
      alpha: 0.95,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 550,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  private releaseSlot(slot: BalloonSlot): void {
    this.tweens.killTweensOf(slot.root)
    if (slot.wobbleTween) {
      slot.wobbleTween.stop()
      slot.wobbleTween = null
    }
    this.setGlow(slot, false)
    slot.spec = null
    slot.state = 'idle'
    slot.body.disableInteractive()
    slot.root.setVisible(false).setScale(1).setAlpha(1).setAngle(0)
  }

  // ─── Movement (update loop, never React state) ───────────────────────────

  update(time: number, delta: number): void {
    const dt = delta / 1000
    for (const slot of this.slots) {
      if (!slot.spec || slot.state !== 'rising') continue
      slot.root.y -= slot.spec.speedCss * this.dpr * dt
      const phase = ((time - slot.spawnTime) / slot.spec.swayPeriodMs) * Math.PI * 2
      slot.root.x = slot.baseX + Math.sin(phase + slot.swayPhase) * slot.spec.swayAmpCss * this.dpr
      if (slot.root.y < -this.px(140)) this.recycleBalloon(slot)
    }
    for (const cloud of this.clouds) {
      cloud.img.x += cloud.speedCss * this.dpr * dt
      const half = cloud.img.displayWidth / 2
      if (cloud.img.x - half > this.scale.width) cloud.img.x = -half
    }
    this.updateCrabReactions(delta)
  }

  /**
   * The crab feels alive: it leans a little toward the nearest floating
   * balloon and its eyes follow it, easing back to rest when the sky is
   * empty. Framerate-independent lerp; writes only crabRoot.x and the eye
   * positions, so it never fights the clap/blink/breathing tweens.
   */
  private updateCrabReactions(delta: number): void {
    let nearest: BalloonSlot | null = null
    let bestDist = Infinity
    for (const slot of this.slots) {
      if (!slot.spec || slot.state !== 'rising') continue
      const d = Math.hypot(slot.root.x - this.crabBaseX, slot.root.y - this.crabBaseY)
      if (d < bestDist) {
        bestDist = d
        nearest = slot
      }
    }

    // Fraction of the remaining gap to close this frame (~ time constant).
    const k = 1 - Math.pow(0.002, delta / 1000)

    // Small — the crab is holding the panel, so it can't wander far from it.
    const maxLean = this.px(10)
    const targetLean = nearest
      ? Phaser.Math.Clamp((nearest.root.x - this.crabBaseX) * 0.14, -maxLean, maxLean)
      : 0
    this.crabLeanX += (targetLean - this.crabLeanX) * k
    this.crabRoot.x = this.crabBaseX + this.crabLeanX

    const maxEye = this.px(7)
    let targetEyeX = 0
    let targetEyeY = 0
    if (nearest) {
      const dx = nearest.root.x - this.crabBaseX
      const dy = nearest.root.y - this.crabBaseY
      const len = Math.max(Math.hypot(dx, dy), 1)
      targetEyeX = (dx / len) * maxEye
      targetEyeY = Phaser.Math.Clamp((dy / len) * maxEye, -maxEye, maxEye)
    }
    this.crabEyeOff.x += (targetEyeX - this.crabEyeOff.x) * k
    this.crabEyeOff.y += (targetEyeY - this.crabEyeOff.y) * k
    for (let i = 0; i < this.crabEyes.length; i++) {
      const base = this.crabEyeBase[i]
      this.crabEyes[i].setPosition(base.x + this.crabEyeOff.x, base.y + this.crabEyeOff.y)
    }
  }

  /**
   * A balloon drifted off the top — respawn it from below. planBalloon
   * enforces the CRITICAL invariant: if the departed balloon was the last
   * match afloat, the replacement IS a match.
   */
  private recycleBalloon(slot: BalloonSlot): void {
    // A matching balloon the child never caught = a motor-axis error signal.
    if (this.roundActive && slot.spec?.isMatch) this.matchEscapes++
    this.releaseSlot(slot)
    if (!this.roundActive || !this.round) return
    const actives = this.slots.filter((s) => s.spec !== null && s.state === 'rising')
    const spec = planBalloon(
      {
        round: this.round,
        skill: this.skill,
        activeMatchCount: actives.filter((s) => s.spec?.isMatch).length,
        // Authoring-space xFracs (what pickXFrac compares against) — NOT
        // baseX/width, which lives in a slightly different screen space.
        activeXFracs: actives.map((s) => s.spec?.xFrac ?? 0.5),
        lastColorIndex: this.lastColorIndex,
      },
      Math.random,
    )
    this.spawnBalloonInSlot(slot, spec)
  }

  // ─── Reactions ───────────────────────────────────────────────────────────

  private onBalloonTap(slot: BalloonSlot): void {
    if (!slot.spec || slot.state !== 'rising') return
    if (!this.roundActive) {
      this.wobbleBalloon(slot)
      playTone(659, 45, 'sine', 0.04)
      return
    }
    if (slot.spec.isMatch) this.popMatch(slot)
    else this.wrongTap(slot)
  }

  /** Soft error: rubber boing, wobble-squash, balloon floats on unpopped. */
  private wrongTap(slot: BalloonSlot): void {
    this.wrongTaps++
    playTone(220, 150, 'sine', 0.06)
    this.time.delayedCall(140, () => playTone(180, 130, 'sine', 0.045))
    this.wobbleBalloon(slot)

    // Escalating hint: after 2 wrong taps, matching balloons pulse-glow.
    if (shouldShowHint(this.wrongTaps) && !this.hintOn) {
      this.hintOn = true
      for (const other of this.slots) {
        if (other.spec?.isMatch && other.state === 'rising') this.setGlow(other, true)
      }
    }
  }

  private wobbleBalloon(slot: BalloonSlot): void {
    if (slot.wobbleTween) slot.wobbleTween.stop()
    slot.root.setAngle(0).setScale(1)
    slot.wobbleTween = this.tweens.add({
      targets: slot.root,
      angle: { from: -9, to: 9 },
      scaleX: 1.08,
      scaleY: 0.92,
      duration: 90,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        slot.root.setAngle(0).setScale(1)
        slot.wobbleTween = null
      },
    })
  }

  /** Correct pop: POP! burst → dots fly to the sign one-by-one, counted aloud. */
  private popMatch(slot: BalloonSlot): void {
    const spec = slot.spec
    if (!spec) return
    this.roundActive = false
    // Adaptive nudge per axis: wrong taps steer cognitive, escapes steer
    // motor (see logic.updateSkill). Saved every round — progress survives
    // an abrupt exit (toddlers don't do graceful shutdowns).
    this.skill = updateSkill(
      this.skill,
      {
        wrongTaps: this.wrongTaps,
        matchEscapes: this.matchEscapes,
        ms: this.time.now - this.roundStartAt,
      },
      this.peak,
    )
    this.peak = {
      motor: Math.max(this.peak.motor, this.skill.motor),
      cognitive: Math.max(this.peak.cognitive, this.skill.cognitive),
    }
    saveSkill(GAME_ID, this.skill)
    slot.state = 'popping'
    slot.body.disableInteractive()
    for (const timer of this.beepTimers) timer.remove(false)
    this.beepTimers = []

    const popX = slot.root.x
    const popY = slot.root.y + this.px(BODY_OFFSET_Y)
    // World positions of the balloon's dots, captured before the squash-burst.
    const sources =
      spec.kind === 'dots'
        ? slot.dots.slice(0, spec.value).map((dot) => ({
            x: slot.root.x + dot.x,
            y: slot.root.y + dot.y,
          }))
        : [{ x: popX, y: popY }]

    playTone(740, 45, 'square', 0.1)
    this.time.delayedCall(45, () => playTone(392, 90, 'square', 0.06))
    this.shredEmitters[spec.colorIndex].explode(18, popX, popY)
    this.stars.explode(7, popX, popY)

    if (slot.wobbleTween) {
      slot.wobbleTween.stop()
      slot.wobbleTween = null
    }
    this.tweens.killTweensOf(slot.root)
    this.tweens.add({
      targets: slot.root,
      scaleX: 1.45,
      scaleY: 0.45,
      duration: 80,
      ease: 'Quad.easeOut',
      onComplete: () => this.releaseSlot(slot),
    })

    this.sweepOthers(slot)
    this.countAloud(spec, sources)
  }

  /** Round over — remaining balloons drift away to make room for the next. */
  private sweepOthers(popped: BalloonSlot): void {
    let i = 0
    for (const slot of this.slots) {
      if (slot === popped || !slot.spec || slot.state !== 'rising') continue
      slot.state = 'leaving'
      slot.body.disableInteractive()
      this.setGlow(slot, false)
      this.tweens.add({
        targets: slot.root,
        y: -this.px(180),
        duration: 700 + i * 130,
        ease: 'Quad.easeIn',
        onComplete: () => this.releaseSlot(slot),
      })
      i++
    }
  }

  /**
   * Descriptive feedback: the popped balloon's dots fly one-by-one to the
   * crab's sign, a rising beep per dot (1, 2, 3…), then the crab claps and
   * the next round begins (with a sky celebration every 5 rounds).
   */
  private countAloud(spec: BalloonSpec, sources: { x: number; y: number }[]): void {
    const target = spec.value
    const points = dotPositions(target, 'dice')

    for (let i = 0; i < target; i++) {
      const isFlyer = spec.kind === 'dots' || i === 0
      if (isFlyer) {
        const source = spec.kind === 'dots' ? sources[i] : sources[0]
        const texture = spec.kind === 'dots' ? 'bp-ink-dot' : `bp-num-${target}`
        const destX =
          spec.kind === 'dots'
            ? this.signRoot.x + points[i].x * this.px(this.signDotSpacing)
            : this.signRoot.x
        const destY =
          spec.kind === 'dots'
            ? this.signRoot.y +
              this.px(this.signDotOriginY) +
              points[i].y * this.px(this.signDotSpacing)
            : this.signRoot.y + this.px(this.signNumeralY)
        const flyer = this.add
          .image(source.x, source.y, texture)
          .setDepth(40)
          .setScale(spec.kind === 'dots' ? 1.2 : 0.8)
        this.tweens.add({
          targets: flyer,
          x: destX,
          y: destY,
          scale: spec.kind === 'dots' ? this.signDotScale : this.signNumeralScale,
          delay: i * COUNT_STEP_MS,
          duration: FLY_MS,
          ease: 'Cubic.easeInOut',
          onComplete: () => {
            this.sparkles.explode(4, destX, destY)
            flyer.destroy()
          },
        })
      }
      this.time.delayedCall(FLY_MS + i * COUNT_STEP_MS, () => {
        playTone(COUNT_BEEPS[i], 190, 'triangle', 0.09)
        this.pulseSignDot(i)
      })
    }

    const doneAt = FLY_MS + (target - 1) * COUNT_STEP_MS + 260
    this.time.delayedCall(doneAt, () => {
      this.crabClap()
      FANFARE.forEach((freq, i) =>
        this.time.delayedCall(i * 110, () => playTone(freq, 150, 'triangle', 0.09)),
      )
      this.roundsCompleted++
      // Every solved round passes a level: badge +1, one persistent star
      // banked (forever visible on the launcher tile).
      reportLevel(levelFor(this.roundsCompleted))
      addStars(GAME_ID)
      // The rainbow is pure animation on its own every-5 beat.
      const celebrate = isSkyCelebration(this.roundsCompleted)
      if (celebrate) this.skyCelebration()
      this.time.delayedCall(celebrate ? 1500 : 550, () => this.startRound())
    })
  }

  /** Crab claps its claws — descriptive praise from the conductor. */
  private crabClap(): void {
    // A happy little hop. Drives crabRoot.y only (update() owns .x), so the
    // lean keeps tracking while the crab bounces.
    this.tweens.add({
      targets: this.crabRoot,
      y: this.crabBaseY - this.px(16),
      duration: 160,
      yoyo: true,
      repeat: 1,
      ease: 'Quad.easeOut',
      onComplete: () => this.crabRoot.setY(this.crabBaseY),
    })
    this.tweens.killTweensOf(this.crabClawLeft)
    this.tweens.killTweensOf(this.crabClawRight)
    // Claws pivot at their shoulder root, so a pure angle wave reads as
    // excited arm-waving and never detaches the arm from the body.
    this.tweens.add({
      targets: this.crabClawLeft,
      angle: CLAW_WAVE,
      duration: 130,
      yoyo: true,
      repeat: 2,
      ease: 'Quad.easeInOut',
      onComplete: () => this.crabClawLeft.setAngle(0),
    })
    this.tweens.add({
      targets: this.crabClawRight,
      angle: -CLAW_WAVE,
      duration: 130,
      yoyo: true,
      repeat: 2,
      ease: 'Quad.easeInOut',
      onComplete: () => this.crabClawRight.setAngle(0),
    })
    for (const delay of [130, 390, 650]) {
      this.time.delayedCall(delay, () => playTone(988, 35, 'square', 0.05))
    }
  }

  // ─── Sky celebration (every 5 correct rounds) ────────────────────────────

  private skyCelebration(): void {
    const w = this.scale.width
    const h = this.scale.height

    // Rainbow arc draws itself across the sky, then fades.
    const progress = { t: 0 }
    this.rainbowGfx.setAlpha(1)
    this.tweens.add({
      targets: progress,
      t: 1,
      duration: 1300,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.drawRainbow(progress.t),
      onComplete: () => {
        this.tweens.add({
          targets: this.rainbowGfx,
          alpha: 0,
          delay: 800,
          duration: 600,
          onComplete: () => {
            this.rainbowGfx.clear()
            this.rainbowGfx.setAlpha(1)
          },
        })
      },
    })

    // Star confetti across the sky.
    this.stars.explode(16, w * 0.25, h * 0.3)
    this.stars.explode(16, w * 0.75, h * 0.3)
    this.time.delayedCall(400, () => this.stars.explode(14, w * 0.5, h * 0.22))
    CELEBRATION_FANFARE.forEach((freq, i) =>
      this.time.delayedCall(300 + i * 100, () => playTone(freq, 160, 'triangle', 0.1)),
    )

    // The next wave spawns mid-celebration; flicker it party-colored briefly.
    this.time.delayedCall(1700, () => {
      const flicker = this.time.addEvent({
        delay: 150,
        repeat: 8,
        callback: () => {
          for (const slot of this.slots) {
            if (slot.spec && slot.state === 'rising') {
              const random = Math.floor(Math.random() * BALLOON_COLORS.length)
              slot.body.setTint(hexToInt(BALLOON_COLORS[random]))
            }
          }
        },
      })
      this.time.delayedCall(150 * 10, () => {
        flicker.remove(false)
        for (const slot of this.slots) {
          if (slot.spec) slot.body.setTint(hexToInt(BALLOON_COLORS[slot.spec.colorIndex]))
        }
      })
    })
  }

  private drawRainbow(t: number): void {
    const w = this.scale.width
    const h = this.scale.height
    const cx = w / 2
    const cy = h * 1.05
    const base = Math.min(w * 0.55, h * 0.75)
    this.rainbowGfx.clear()
    RAINBOW.forEach((color, i) => {
      this.rainbowGfx.lineStyle(this.px(10), color, 0.85)
      this.rainbowGfx.beginPath()
      this.rainbowGfx.arc(cx, cy, base - i * this.px(11), Math.PI, Math.PI + Math.PI * t, false)
      this.rainbowGfx.strokePath()
    })
  }

  // ─── Crab blinking (idle life) ───────────────────────────────────────────

  private scheduleBlink(): void {
    this.blinkTimer = this.time.delayedCall(3000 + Math.random() * 3000, () => {
      this.tweens.add({
        targets: this.crabEyes,
        // Relative to the sprite's display scale — an absolute 0.12 would be
        // 0.12 of the intrinsic ~340px sprite, not of the on-screen eye.
        scaleY: this.crabEyeBaseScale * 0.12,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeInOut',
        onComplete: () => {
          for (const eye of this.crabEyes) eye.setScale(this.crabEyeBaseScale)
          this.scheduleBlink()
        },
      })
    })
  }
}

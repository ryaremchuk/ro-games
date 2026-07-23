import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { initLevel, reportLevel } from '../../shared/level'
import { addStars } from '../../shared/progress'
import { onViewportResize, viewportSize } from '../../shared/viewport'
import { CARD_SUBJECTS, PAW_PRINT } from './art'
import type { ArtSubject } from './art'
import { cardsForLevel, dealBoard, isMatch, rowsFor } from './logic'
import type { MemoryTestApi } from './testHook'

/** Registry id — also the key the shared progress store files this under. */
const GAME_ID = 'memory'

// ─── Palette (art spec) ──────────────────────────────────────────────────────
const SKY = 0xbbe3f5
const HILL_BACK = 0xcdebb8
const HILL_FRONT = 0xb4dfa0
const SUN = 0xffe9a8
const CLOUD = 0xffffff
const CARD_BACK = 0x4fc3f7
const CARD_FRONT = 0xfff8f0
const CARD_BORDER = 0xffffff
const CARD_SHADOW = 0x000000
const GLOW = 0xffe082
const CONFETTI_TINTS = [0x4fc3f7, 0xf48fb1, 0xffe082, 0xa5d6a7, 0xce93d8, 0xffab91]
const SPARKLE_TINTS = [0xffe082, 0xfff176, 0xffb74d, 0xf48fb1]

// ─── Timing / sizing constants (css px unless noted) ─────────────────────────
const IDLE_MS = 10_000
const MISMATCH_HOLD_MS = 1500
const DEAL_STAGGER_MS = 80
const DEAL_FLY_MS = 420
const TOP_STRIP = 72 // home button + level badge live here
const BOTTOM_STRIP = 34 // iOS home indicator
const OUTER_PAD = 24
const CARD_MAX = 260
const CARD_MIN = 120
const GAP_MIN = 16
const SLOP = 24 // touch slop beyond the visual card bounds

interface Card {
  index: number
  subjectKey: string
  pairId: number
  blob: number
  container: Phaser.GameObjects.Container
  shadow: Phaser.GameObjects.Graphics
  glow: Phaser.GameObjects.Graphics
  back: Phaser.GameObjects.Graphics
  paw: Phaser.GameObjects.Image
  front: Phaser.GameObjects.Graphics
  art: Phaser.GameObjects.Image
  faceUp: boolean
  matched: boolean
  slotX: number
  slotY: number
}

export default class MemoryScene extends Phaser.Scene {
  private dpr = 1
  private level = 1
  private cards: Card[] = []
  private firstUp: Card | null = null
  private busy = false
  private celebrating = false
  private dealing = false
  private matchesInLevel = 0
  private matchCount = 0
  private cardSize = 0
  private gap = 0
  private portrait = false

  private bg!: Phaser.GameObjects.Graphics
  private fade!: Phaser.GameObjects.Rectangle
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private fireworks!: Phaser.GameObjects.Particles.ParticleEmitter
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private confettiZone!: Phaser.Geom.Rectangle

  private subjectByKey = new Map<string, ArtSubject>()
  /** Long-running scheduled callbacks (deal / mismatch / celebration tones). */
  private timers = new Set<Phaser.Time.TimerEvent>()
  private idleTimer: Phaser.Time.TimerEvent | null = null

  constructor() {
    super('memory')
  }

  private px(css: number): number {
    return css * this.dpr
  }

  // ─── Asset load ────────────────────────────────────────────────────────────

  preload(): void {
    for (const subject of CARD_SUBJECTS) {
      this.load.image(`art-${subject.key}`, subject.textureUrl)
    }
    this.load.image(`art-${PAW_PRINT.key}`, PAW_PRINT.textureUrl)
  }

  create(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.subjectByKey = new Map(CARD_SUBJECTS.map((s) => [s.key, s]))
    this.makeTextures()

    this.bg = this.add.graphics().setDepth(-10)
    this.fade = this.add
      .rectangle(0, 0, 10, 10, 0xffffff)
      .setOrigin(0, 0)
      .setDepth(200)
      .setAlpha(0)
      .setVisible(false)
    this.buildEmitters()

    // Resume the visible level badge from the saved star trophy (every board
    // cleared banked one star), so the count climbs across sessions.
    initLevel(GAME_ID)
    this.level = 1
    reportLevel(this.level)
    this.drawBackground()
    this.dealLevel()

    const offViewport = onViewportResize(this.handleResize)
    const teardown = (): void => {
      offViewport()
      this.idleTimer?.remove(false)
      this.idleTimer = null
      for (const timer of this.timers) timer.remove(false)
      this.timers.clear()
      this.tweens.killAll()
      this.teardownTestApi()
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
    // React unmount calls game.destroy(), which emits DESTROY (not SHUTDOWN).
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown)

    // Dev/e2e hook (tree-shaken from production). The canvas is opaque to the
    // DOM, so Playwright reads state and taps card centers via this. See testHook.
    if (import.meta.env.DEV || location.search.includes('e2e')) this.exposeTestApi()
  }

  // ─── E2E test hook (dev-only) ───────────────────────────────────────────────

  private testApi?: MemoryTestApi

  private exposeTestApi(): void {
    const api: MemoryTestApi = {
      state: () => ({
        level: this.level,
        cardCount: this.cards.length,
        matchesInLevel: this.matchesInLevel,
        busy: this.busy,
        celebrating: this.celebrating,
        dealing: this.dealing,
        cards: this.cards.map((c) => ({
          faceUp: c.faceUp,
          matched: c.matched,
          subjectKey: c.subjectKey,
          xCss: c.container.x / this.dpr,
          yCss: c.container.y / this.dpr,
          sizeCss: this.cardSize / this.dpr,
        })),
      }),
    }
    this.testApi = api
    window.__memory = api
  }

  private teardownTestApi(): void {
    // Identity guard: React StrictMode double-mounts in dev and Phaser defers
    // destroy() to the next step, so a late DESTROY can fire after the remount
    // installed its own hook. Only remove ours, never the live one.
    if (this.testApi && window.__memory === this.testApi) delete window.__memory
  }

  /** Tracked delayed call — removed en masse on teardown so nothing fires late. */
  private schedule(delay: number, cb: () => void): Phaser.Time.TimerEvent {
    const timer = this.time.delayedCall(delay, () => {
      this.timers.delete(timer)
      cb()
    })
    this.timers.add(timer)
    return timer
  }

  // ─── Textures ───────────────────────────────────────────────────────────────

  private makeTextures(): void {
    if (!this.textures.exists('mem-star')) {
      const g = this.add.graphics()
      const cx = this.px(12)
      const cy = this.px(12)
      const outer = this.px(11)
      const inner = this.px(4.6)
      const points: Phaser.Math.Vector2[] = []
      let rot = -Math.PI / 2
      const step = Math.PI / 5
      for (let i = 0; i < 5; i++) {
        points.push(new Phaser.Math.Vector2(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer))
        rot += step
        points.push(new Phaser.Math.Vector2(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner))
        rot += step
      }
      g.fillStyle(0xffffff, 1)
      g.fillPoints(points, true)
      g.generateTexture('mem-star', this.px(24), this.px(24))
      g.destroy()
    }
    if (!this.textures.exists('mem-confetti')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillRoundedRect(0, 0, this.px(14), this.px(9), this.px(3))
      g.generateTexture('mem-confetti', this.px(14), this.px(9))
      g.destroy()
    }
  }

  private buildEmitters(): void {
    // Match sparkle burst — warm confetti stars, no additive blending.
    this.sparkles = this.add
      .particles(0, 0, 'mem-star', {
        speed: { min: this.px(150), max: this.px(320) },
        gravityY: this.px(300),
        lifespan: 700,
        scale: { start: 0.9, end: 0 },
        rotate: { start: 0, end: 180 },
        tint: SPARKLE_TINTS,
        emitting: false,
      })
      .setDepth(100)

    // Level-complete firework bursts — bright, additive.
    this.fireworks = this.add
      .particles(0, 0, 'mem-star', {
        speed: { min: this.px(150), max: this.px(340) },
        gravityY: this.px(120),
        lifespan: 900,
        scale: { start: 1, end: 0 },
        tint: [0xffffff, ...SPARKLE_TINTS],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(100)

    // Level-complete confetti rain from the top; scaleX flutters like paper.
    this.confettiZone = new Phaser.Geom.Rectangle(0, -this.px(20), this.scale.width, this.px(6))
    const config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
      speedY: { min: this.px(200), max: this.px(350) },
      speedX: { min: -this.px(40), max: this.px(40) },
      gravityY: this.px(250),
      lifespan: 2600,
      quantity: 4,
      frequency: 40,
      scaleX: {
        onEmit: () => 1,
        onUpdate: (_p, _k, t) => Math.cos(t * Math.PI * 6),
      },
      scaleY: 1,
      rotate: { min: 0, max: 360 },
      tint: CONFETTI_TINTS,
      emitZone: { type: 'random', source: this.confettiZone, quantity: 1 },
      emitting: false,
    }
    this.confetti = this.add.particles(0, 0, 'mem-confetti', config).setDepth(100)
  }

  // ─── Background ───────────────────────────────────────────────────────────

  private drawBackground(): void {
    const w = this.scale.width
    const h = this.scale.height
    const g = this.bg
    g.clear()
    g.fillStyle(SKY, 1)
    g.fillRect(0, 0, w, h)
    // Two soft hill bands rising from the bottom (no outlines).
    g.fillStyle(HILL_BACK, 1)
    g.fillEllipse(w * 0.32, h * 0.98, w * 1.5, h * 0.55)
    g.fillStyle(HILL_FRONT, 1)
    g.fillEllipse(w * 0.74, h * 1.06, w * 1.6, h * 0.6)
    // Plain sun disc, top-right (clear of the top-left home button / badge).
    g.fillStyle(SUN, 0.9)
    g.fillCircle(w * 0.83, h * 0.14, this.px(46))
    // A few pale blob clouds — static so they never compete with the cards.
    g.fillStyle(CLOUD, 0.7)
    this.drawCloud(g, w * 0.22, h * 0.16, this.px(46))
    this.drawCloud(g, w * 0.6, h * 0.09, this.px(38))
    this.drawCloud(g, w * 0.46, h * 0.26, this.px(34))
  }

  private drawCloud(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    g.fillEllipse(x, y, r * 2.4, r * 1.3)
    g.fillEllipse(x - r * 0.7, y + r * 0.2, r * 1.5, r)
    g.fillEllipse(x + r * 0.8, y + r * 0.25, r * 1.4, r * 0.9)
  }

  // ─── Layout ──────────────────────────────────────────────────────────────

  /** Largest card size (and matching gap) that fits the board for this grid. */
  private fitCards(cols: number, rowCount: number, boardW: number, boardH: number): void {
    const max = this.px(CARD_MAX)
    const min = this.px(CARD_MIN)
    const minGap = this.px(GAP_MIN)
    // First assume gap = 12% of the card size.
    const wLimit = boardW / (cols + 0.12 * (cols - 1))
    const hLimit = boardH / (rowCount + 0.12 * (rowCount - 1))
    let size = Math.min(wLimit, hLimit, max)
    let gap = 0.12 * size
    if (gap < minGap) {
      // The proportional gap fell below the floor — pin it and refit.
      gap = minGap
      const wLimit2 = (boardW - (cols - 1) * gap) / cols
      const hLimit2 = (boardH - (rowCount - 1) * gap) / rowCount
      size = Math.min(wLimit2, hLimit2, max)
    }
    this.cardSize = Math.max(size, min)
    this.gap = gap
  }

  private computeLayout(): void {
    const w = this.scale.width
    const h = this.scale.height
    this.portrait = h >= w
    const rows = rowsFor(this.cards.length, this.portrait)
    const rowCount = rows.length
    const cols = Math.max(...rows)

    const boardLeft = this.px(OUTER_PAD)
    const boardTop = this.px(TOP_STRIP + OUTER_PAD)
    const boardW = w - this.px(OUTER_PAD) * 2
    const boardH = h - this.px(TOP_STRIP + BOTTOM_STRIP + OUTER_PAD * 2)

    this.fitCards(cols, rowCount, boardW, boardH)
    const size = this.cardSize
    const gap = this.gap
    const gridH = rowCount * size + (rowCount - 1) * gap
    const startY = boardTop + (boardH - gridH) / 2 + size / 2

    let k = 0
    rows.forEach((rowLen, r) => {
      // Centered-row x-offset: (boardW - rowLen*(cardW+gap) + gap) / 2.
      const offset = (boardW - rowLen * (size + gap) + gap) / 2
      const startX = boardLeft + offset + size / 2
      const cy = startY + r * (size + gap)
      for (let j = 0; j < rowLen; j++) {
        const card = this.cards[k++]
        card.slotX = startX + j * (size + gap)
        card.slotY = cy
      }
    })
  }

  /** Redraw a card's vector body/shadow/glow at the current size + refit its hit area. */
  private drawCardGraphics(card: Card): void {
    const s = this.cardSize
    const r = 0.12 * s
    const b = 0.05 * s
    const off = this.px(6)
    const half = s / 2

    card.shadow.clear()
    card.shadow.fillStyle(CARD_SHADOW, 0.15)
    card.shadow.fillRoundedRect(-half, -half + off, s, s, r)

    card.glow.clear()
    card.glow.fillStyle(GLOW, 1)
    card.glow.fillRoundedRect(-half, -half, s, s, r)

    card.back.clear()
    card.back.fillStyle(CARD_BORDER, 1)
    card.back.fillRoundedRect(-half, -half, s, s, r)
    card.back.fillStyle(CARD_BACK, 1)
    card.back.fillRoundedRect(-half + b, -half + b, s - 2 * b, s - 2 * b, Math.max(r - b, 2))

    card.front.clear()
    card.front.fillStyle(CARD_BORDER, 1)
    card.front.fillRoundedRect(-half, -half, s, s, r)
    card.front.fillStyle(CARD_FRONT, 1)
    card.front.fillRoundedRect(-half + b, -half + b, s - 2 * b, s - 2 * b, Math.max(r - b, 2))
    card.front.fillStyle(card.blob, 1)
    card.front.fillCircle(0, 0, 0.34 * s)

    card.paw.setDisplaySize(0.55 * s, 0.55 * s)
    card.art.setDisplaySize(0.8 * s, 0.8 * s)

    // Touch slop extends the hit area, capped at half the gap so neighbours
    // never overlap.
    const slop = Math.min(this.px(SLOP), this.gap / 2)
    const hit = s + slop * 2
    const rect = card.container.input?.hitArea as Phaser.Geom.Rectangle | undefined
    if (rect) rect.setTo(-hit / 2, -hit / 2, hit, hit)
  }

  // ─── Dealing ───────────────────────────────────────────────────────────────

  private createCard(subjectKey: string, pairId: number, index: number): Card {
    const subject = this.subjectByKey.get(subjectKey)
    const container = this.add.container(0, 0).setDepth(1)
    const shadow = this.add.graphics()
    const glow = this.add.graphics().setAlpha(0)
    const back = this.add.graphics()
    const paw = this.add.image(0, 0, `art-${PAW_PRINT.key}`)
    const front = this.add.graphics().setVisible(false)
    const art = this.add.image(0, 0, `art-${subjectKey}`).setVisible(false)
    container.add([shadow, glow, back, paw, front, art])

    const card: Card = {
      index,
      subjectKey,
      pairId,
      blob: Phaser.Display.Color.HexStringToColor(subject?.blob ?? '#FFFFFF').color,
      container,
      shadow,
      glow,
      back,
      paw,
      front,
      art,
      faceUp: false,
      matched: false,
      slotX: 0,
      slotY: 0,
    }
    container.setInteractive(
      new Phaser.Geom.Rectangle(-1, -1, 2, 2),
      Phaser.Geom.Rectangle.Contains,
    )
    container.on('pointerdown', () => this.onCardDown(card))
    return card
  }

  private clearCards(): void {
    for (const card of this.cards) card.container.destroy()
    this.cards = []
  }

  private dealLevel(): void {
    this.celebrating = false
    this.busy = false
    this.firstUp = null
    this.matchesInLevel = 0
    this.clearCards()

    const count = cardsForLevel(this.level)
    const keys = CARD_SUBJECTS.map((s) => s.key)
    const board = dealBoard(count, keys, Math.random)
    this.cards = board.map((bc, i) => this.createCard(bc.subjectKey, bc.pairId, i))

    this.computeLayout()
    for (const card of this.cards) {
      this.drawCardGraphics(card)
      this.setFace(card, false)
    }
    this.dealIn()
  }

  private dealIn(): void {
    this.dealing = true
    const w = this.scale.width
    const h = this.scale.height
    const startX = w / 2
    const startY = h + this.cardSize
    this.cards.forEach((card, i) => {
      const c = card.container
      c.setPosition(startX, startY).setAngle(25).setScale(0.5).setAlpha(1)
      this.schedule(i * DEAL_STAGGER_MS, () => {
        this.tweens.add({
          targets: c,
          x: card.slotX,
          y: card.slotY,
          angle: 0,
          scaleX: 1,
          scaleY: 1,
          duration: DEAL_FLY_MS,
          ease: 'Back.easeOut',
          onComplete: () => playTone(523 * Math.pow(2, i / 24), 45, 'sine', 0.05),
        })
      })
    })
    const last = this.cards.length - 1
    const total = last * DEAL_STAGGER_MS + DEAL_FLY_MS + 100
    this.schedule(total, () => {
      this.dealing = false
      this.scheduleIdleHint()
    })
  }

  // ─── Face helpers ────────────────────────────────────────────────────────

  private setFace(card: Card, up: boolean): void {
    card.back.setVisible(!up)
    card.paw.setVisible(!up)
    card.front.setVisible(up)
    card.art.setVisible(up)
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  private blip(): void {
    playTone(660, 30, 'sine', 0.03)
  }

  private onCardDown(card: Card): void {
    this.noteInput()
    if (this.celebrating) return
    if (this.dealing) {
      this.blip()
      return
    }
    if (this.busy) {
      this.blip()
      return
    }
    if (card.faceUp || card.matched) {
      this.blip()
      return
    }
    this.flipUp(card)
  }

  private flipUp(card: Card): void {
    card.faceUp = true
    if (this.firstUp === null) {
      this.firstUp = card
      this.flip(card, true, true)
    } else {
      const first = this.firstUp
      this.firstUp = null
      this.busy = true
      this.flip(card, true, true, () => this.resolve(first, card))
    }
  }

  /** Two-half scaleX flip; swaps the visible face at scaleX = 0. */
  private flip(card: Card, toUp: boolean, squash: boolean, onDone?: () => void): void {
    const c = card.container
    this.tweens.killTweensOf(c)
    c.setAngle(0)
    playTone(440, 60, 'triangle', 0.04)

    const half1 = (): void => {
      this.tweens.add({
        targets: c,
        scaleX: 0,
        scaleY: 1.06,
        duration: 180,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          this.setFace(card, toUp)
          this.tweens.add({
            targets: c,
            scaleX: 1,
            scaleY: 1,
            duration: 180,
            ease: 'Cubic.easeOut',
            onComplete: () => onDone?.(),
          })
        },
      })
    }

    if (squash) {
      // Tap squash reads as a press; the flip starts <100ms after the touch.
      this.tweens.add({
        targets: c,
        scaleX: 0.94,
        scaleY: 0.94,
        duration: 60,
        ease: 'Quad.easeOut',
        onComplete: half1,
      })
    } else {
      half1()
    }
  }

  private resolve(a: Card, b: Card): void {
    if (isMatch(a, b)) this.onMatch(a, b)
    else this.onMismatch(a, b)
  }

  // ─── Match ─────────────────────────────────────────────────────────────────

  private onMatch(a: Card, b: Card): void {
    this.busy = false // match feedback is non-blocking — the rest stay tappable
    a.matched = true
    b.matched = true
    this.matchesInLevel++
    this.matchCount++
    const secondFreq = this.matchCount % 3 === 0 ? 784 : 659

    this.schedule(150, () => {
      playTone(523, 120, 'triangle', 0.12)
      this.schedule(110, () => playTone(secondFreq, 120, 'triangle', 0.12))
      this.popMatchCard(a)
      this.popMatchCard(b)
    })

    if (this.matchesInLevel >= this.cards.length / 2) this.startLevelComplete()
  }

  private popMatchCard(card: Card): void {
    const c = card.container
    this.tweens.killTweensOf(c)
    // Pop 1 → 1.18 → 1.
    this.tweens.add({
      targets: c,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 150,
      ease: 'Back.easeOut',
      yoyo: true,
      onComplete: () => this.settleMatched(card),
    })
    // Glow pulse behind the card.
    card.glow.setScale(1).setAlpha(0)
    this.tweens.add({
      targets: card.glow,
      alpha: { from: 0, to: 0.9 },
      duration: 250,
      yoyo: true,
      ease: 'Sine.easeOut',
    })
    this.tweens.add({
      targets: card.glow,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 500,
      ease: 'Sine.easeOut',
      onComplete: () => card.glow.setScale(1).setAlpha(0),
    })
    // Star sparkle explosion at the card center.
    this.sparkles.explode(12, c.x, c.y)
    // Art-only wag.
    card.art.setAngle(0)
    this.tweens.add({
      targets: card.art,
      angle: { from: -6, to: 6 },
      duration: 90,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => card.art.setAngle(0),
    })
  }

  private settleMatched(card: Card): void {
    this.tweens.add({
      targets: card.container,
      alpha: 0.85,
      scaleX: 0.94,
      scaleY: 0.94,
      duration: 250,
      ease: 'Sine.easeOut',
    })
  }

  // ─── Mismatch ────────────────────────────────────────────────────────────

  private onMismatch(a: Card, b: Card): void {
    // busy is already true (set when the 2nd card was tapped); hold both up so
    // the child can study them — do NOT shorten this learning window.
    this.schedule(1100, () => {
      for (const card of [a, b]) {
        this.tweens.add({
          targets: card.container,
          angle: { from: -3, to: 3 },
          duration: 120,
          yoyo: true,
          repeat: 2,
          ease: 'Sine.easeInOut',
          onComplete: () => card.container.setAngle(0),
        })
      }
      playTone(330, 120, 'sine', 0.05)
      this.schedule(130, () => playTone(262, 120, 'sine', 0.05))
    })

    this.schedule(MISMATCH_HOLD_MS + 100, () => {
      this.busy = false
      a.faceUp = false
      b.faceUp = false
      a.container.setAngle(0)
      b.container.setAngle(0)
      this.flip(a, false, false)
      this.flip(b, false, false)
    })
  }

  // ─── Level complete ─────────────────────────────────────────────────────

  private startLevelComplete(): void {
    this.celebrating = true
    // Board cleared = level passed: one persistent star on the launcher tile.
    addStars(GAME_ID)

    this.schedule(400, () => this.waveHop())
    this.schedule(500, () => this.confetti.start())
    this.schedule(500 + 2200, () => this.confetti.stop())
    for (const t of [700, 1300, 1900]) this.schedule(t, () => this.fireworkBurst())
    const fanfare = [523, 587, 659, 784, 1047]
    fanfare.forEach((f, i) => this.schedule(500 + i * 140, () => playTone(f, 160, 'triangle', 0.1)))
    this.schedule(3200, () => this.advanceLevel())
  }

  private waveHop(): void {
    this.cards.forEach((card, i) => {
      const c = card.container
      this.tweens.killTweensOf(c)
      c.setAngle(0).setAlpha(1).setScale(1)
      this.schedule(i * 70, () => {
        this.tweens.add({
          targets: c,
          y: c.y - this.px(40),
          angle: { from: -5, to: 5 },
          duration: 280,
          ease: 'Quad.easeOut',
          yoyo: true,
          repeat: 2,
          onComplete: () => {
            c.y = card.slotY
            c.setAngle(0)
          },
        })
      })
    })
  }

  private fireworkBurst(): void {
    const x = Phaser.Math.Between(this.scale.width * 0.15, this.scale.width * 0.85)
    const y = Phaser.Math.Between(this.scale.height * 0.08, this.scale.height * 0.33)
    this.fireworks.explode(24, x, y)
    playTone(880, 120, 'triangle', 0.09)
  }

  private advanceLevel(): void {
    this.level++
    reportLevel(this.level)
    this.fade.setSize(this.scale.width, this.scale.height).setAlpha(0).setVisible(true)
    this.tweens.add({
      targets: this.fade,
      alpha: 0.6,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.dealLevel()
        this.tweens.add({
          targets: this.fade,
          alpha: 0,
          duration: 150,
          ease: 'Sine.easeOut',
          onComplete: () => this.fade.setVisible(false),
        })
      },
    })
  }

  // ─── Idle hint ─────────────────────────────────────────────────────────────

  private noteInput(): void {
    this.scheduleIdleHint()
  }

  private scheduleIdleHint(): void {
    this.idleTimer?.remove(false)
    this.idleTimer = this.time.delayedCall(IDLE_MS, () => this.idleHint())
  }

  private idleHint(): void {
    if (this.busy || this.celebrating || this.dealing) {
      this.scheduleIdleHint()
      return
    }
    const down = this.cards.filter((c) => !c.faceUp && !c.matched)
    if (down.length > 0) {
      for (const card of down) {
        this.tweens.add({
          targets: card.container,
          scaleX: 1.04,
          scaleY: 1.04,
          duration: 600,
          yoyo: true,
          ease: 'Sine.easeInOut',
        })
      }
      playTone(523, 120, 'sine', 0.03)
    }
    this.scheduleIdleHint()
  }

  // ─── Resize ────────────────────────────────────────────────────────────────

  private handleResize = (): void => {
    const vp = viewportSize()
    const w = vp.width * this.dpr
    const h = vp.height * this.dpr
    if (w === this.scale.width && h === this.scale.height) return
    this.scale.resize(w, h)
    this.relayout()
  }

  /**
   * Complete active layout-affecting tweens, then rebuild positions/sizes for
   * the new viewport. Each card snaps to its resting look for its state.
   */
  private relayout(): void {
    this.drawBackground()
    this.confettiZone.width = this.scale.width
    this.fade.setSize(this.scale.width, this.scale.height)
    if (this.cards.length === 0) return

    for (const card of this.cards) {
      this.tweens.killTweensOf(card.container)
      this.tweens.killTweensOf(card.art)
      this.tweens.killTweensOf(card.glow)
    }
    this.computeLayout()
    for (const card of this.cards) {
      this.drawCardGraphics(card)
      const c = card.container
      c.setPosition(card.slotX, card.slotY).setAngle(0)
      card.glow.setAlpha(0).setScale(1)
      card.art.setAngle(0)
      if (card.matched) {
        c.setAlpha(0.85).setScale(0.94)
        this.setFace(card, true)
      } else {
        c.setAlpha(1).setScale(1)
        this.setFace(card, card.faceUp)
      }
    }
    if (this.dealing) {
      this.dealing = false
      this.scheduleIdleHint()
    }
  }
}

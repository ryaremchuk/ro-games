import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { reportLevel } from '../../shared/level'
import { addStars, loadProgress, saveData, saveSkill, sessionStart } from '../../shared/progress'
import { onViewportResize, viewportSize } from '../../shared/viewport'
import {
  ALL_FOODS,
  COLOR_HEX,
  SKILL_MAX,
  SKILL_START,
  TRAY_SIZE,
  bubbleItems,
  generateRound,
  grayedBubbleItems,
  isRoundComplete,
  levelForRound,
  requestTotal,
  updateSkill,
  wantsFood,
} from './logic'
import type { FoodRequest, Round, TaskKind } from './logic'
import {
  FRIENDS_PER_EPISODE,
  GROW_STEPS,
  darken,
  detailsForFriend,
  episodeFor,
  feedStep,
  friendColor,
  journeyFromData,
  journeyToData,
  scaleForStep,
  shrinkStep,
  visibleDetails,
} from './journey'
import type { DetailKind, Episode, JourneyState } from './journey'
import { DETAIL_ART, artEntries, artKey, friendSpec } from './art'
import type { FeedTestApi } from './testHook'

/** Registry id — also the key the shared progress store files this under. */
const GAME_ID = 'feed-the-monster'

// ART SPEC palette (episode palettes override the scenery at runtime).
const PINK = 0xff8fab
const INK = 0x3d3a4b
const CONFETTI_TINTS = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff8fab, 0x9b5de5]

// Pentatonic-ish happy tones (C5 D5 E5 G5 A5) + C6 for big moments.
const PENTA = [523, 587, 659, 784, 880]

const FOOD_CSS = 64 // emoji strike stays crisp at ≤80 css px
const BUBBLE_ITEM_CSS = 44

// The task panel lives at the very top of the screen, in its own bar —
// detached from the friend (was: a thought bubble above the head).
const PANEL_H_CSS = 96
const PANEL_CENTER_Y_CSS = 58

interface XY {
  x: number
  y: number
}

/** Deterministic 0..1 jitter so blob shapes are stable per seed. */
function jitter(i: number, seed: number): number {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return v - Math.floor(v)
}

export default class FeedTheMonsterScene extends Phaser.Scene {
  private dpr = 1
  private bodyR = 0
  private growth = 1

  private roundNumber = 0
  private round: Round | null = null
  private eaten: string[] = []
  private previousRequest?: FoodRequest
  private transitioning = false
  private sneezing = false
  private funnyUntil = 0

  // Adaptive cognitive meter (invisible; drives the task registry).
  private skill = SKILL_START
  private skillPeak = SKILL_START
  private roundStartAt = 0
  private spitBacks = 0
  private recentKinds: TaskKind[] = []

  // The visible long-term journey: growing friends, episodes (journey.ts).
  private journey: JourneyState = { episode: 0, friendsFed: 0, growthStep: 0 }
  private episode!: Episode
  private detailPlan: DetailKind[] = []
  private detailObjects = new Map<DetailKind, Phaser.GameObjects.GameObject[]>()
  private minis: Phaser.GameObjects.Container[] = []

  private bgGfx!: Phaser.GameObjects.Graphics
  private bgImage!: Phaser.GameObjects.Image

  private monster!: Phaser.GameObjects.Container
  private monsterBody!: Phaser.GameObjects.Image
  /** monsterBody's resting scale (art sprites need ≠1; breathe is relative). */
  private bodyScale = 1
  private eyeL!: Phaser.GameObjects.Container
  private eyeR!: Phaser.GameObjects.Container
  private pupilL!: Phaser.GameObjects.Ellipse
  private pupilR!: Phaser.GameObjects.Ellipse
  private mouthLips!: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Image
  private mouthTongue!: Phaser.GameObjects.Ellipse
  /** mouthLips' resting scale — applyMouth animates relative to it. */
  private mouthBase = { x: 1, y: 1 }
  /** True when mouthLips is the face-mouth sprite (tongue is baked in). */
  private artMouth = false
  private nose!: Phaser.GameObjects.Ellipse

  private bubble!: Phaser.GameObjects.Container
  private panelGfx!: Phaser.GameObjects.Graphics
  private panelHit: Phaser.GameObjects.Rectangle | null = null
  private bubblePics: Phaser.GameObjects.Image[] = []
  /** Extra bubble decorations (dot pips, ban overlay) cleared per request. */
  private bubbleExtras: Phaser.GameObjects.GameObject[] = []
  /** Dot pips of a dots round, lit one-by-one as the child feeds. */
  private pips: Phaser.GameObjects.Arc[] = []

  private plates: Phaser.GameObjects.Image[] = []
  private foods: Phaser.GameObjects.Image[] = []
  private dragged: Phaser.GameObjects.Image | null = null

  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private stars!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private puffs!: Phaser.GameObjects.Particles.ParticleEmitter

  private mouthState = { open: 0 }
  private mouthTween: Phaser.Tweens.Tween | null = null

  constructor() {
    super('feed-the-monster')
  }

  private px(css: number): number {
    return css * this.dpr
  }

  /** Register whatever reskin art shipped (art.ts glob); missing = fallback. */
  preload(): void {
    for (const [name, url] of artEntries()) {
      this.load.image(artKey(name), url)
    }
  }

  /** Is this art sprite available? Consumers fall back to procedural looks. */
  private hasArt(name: string): boolean {
    return this.textures.exists(artKey(name))
  }

  create(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.bodyR = Math.min(Math.min(this.scale.width, this.scale.height) * 0.17, this.px(150))

    // Resume the saved skill meter a couple of steps down (warm-up ramp);
    // the peak makes below-peak climbs twice as fast (see logic.updateSkill).
    const saved = loadProgress(GAME_ID)
    this.skillPeak = saved.skill.cognitive ?? SKILL_START
    this.skill = sessionStart(this.skillPeak, { max: SKILL_MAX, lastPlayedAt: saved.lastPlayedAt })

    // Resume the journey exactly where it left off — the long-term
    // progression (friends grown, episodes) survives restarts by design.
    this.journey = journeyFromData(saved.data)
    this.episode = episodeFor(this.journey)
    this.growth = scaleForStep(this.journey.growthStep)
    this.detailPlan = detailsForFriend(this.journey.episode, this.journey.friendsFed)

    this.makeTextures()

    this.bgGfx = this.add.graphics().setDepth(0)
    // Full-bleed episode backdrop (bg-<episode>.png), cover-scaled in layout();
    // the gradient beneath stays as the fallback and edge filler.
    this.bgImage = this.add.image(0, 0, '__DEFAULT').setDepth(0).setVisible(false)
    this.buildMonster()
    this.buildPlates()
    this.buildBubble()
    this.buildEmitters()
    this.wireInput()

    // Restore the fed-friends lineup + current friend's details, no fanfare.
    for (let i = 0; i < this.journey.friendsFed; i++) this.spawnMini(i)
    this.syncDetails(false)

    this.layout()
    this.scheduleBlink()

    const teardown = (): void => {
      offViewport()
      this.teardownTestApi()
    }
    const offViewport = onViewportResize(this.handleWindowResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
    // React unmount calls game.destroy(), which emits DESTROY (not SHUTDOWN) —
    // without this the viewport listener leaks and fires on a dead scene.
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown)

    // Dev/e2e hook (dev builds, or prod behind `?e2e` — never in normal
    // play). Lets Playwright read state and force a task kind — the canvas
    // is opaque to the DOM. See testHook.
    if (import.meta.env.DEV || location.search.includes('e2e')) this.exposeTestApi()

    this.time.delayedCall(350, () => this.startRound(1))
  }

  // ─── E2E test hook (dev-only) ──────────────────────────────────────────────

  private testApi?: FeedTestApi

  private exposeTestApi(): void {
    const api: FeedTestApi = {
      state: () => ({
        round: this.roundNumber,
        taskKind: this.round?.taskKind ?? null,
        skill: this.skill,
        eaten: [...this.eaten],
        requestTotal: this.round ? requestTotal(this.round.request) : 0,
        spitBacks: this.spitBacks,
        transitioning: this.transitioning,
        foods: this.foods.map((f) => ({
          foodId: f.getData('foodId') as string,
          correct: this.round
            ? wantsFood(this.round.request, this.eaten, f.getData('foodId') as string)
            : false,
          xCss: f.x / this.dpr,
          yCss: f.y / this.dpr,
        })),
        mouth: { xCss: this.mouthWorld().x / this.dpr, yCss: this.mouthWorld().y / this.dpr },
        bubbleTiles: this.bubblePics.length,
        journey: { ...this.journey },
        episodeId: this.episode.id,
        growthScale: this.monster.scaleX,
        details: [...this.detailObjects.keys()],
        miniCount: this.minis.length,
      }),
      forceKind: (kind) => {
        if (this.transitioning || !this.round) return false
        const round = generateRound({
          round: this.roundNumber,
          skill: this.skill,
          previous: this.previousRequest,
          foods: this.episode.foods,
          forceKind: kind,
        })
        this.round = round
        this.previousRequest = round.request
        this.eaten = []
        this.spitBacks = 0
        this.roundStartAt = this.time.now
        this.buildTray(round.tray)
        this.showRequest(round.request)
        return true
      },
      forceJourney: (partial) => {
        if (this.transitioning || !this.round) return false
        this.journey = journeyFromData({ ...journeyToData(this.journey), ...partial })
        saveData(GAME_ID, journeyToData(this.journey))

        // Rebuild the world at the forced point: theme, friend, lineup.
        this.episode = episodeFor(this.journey)
        this.makeTextures()
        for (const mini of this.minis) {
          this.tweens.killTweensOf(mini)
          mini.destroy()
        }
        this.minis = []
        for (let i = 0; i < this.journey.friendsFed; i++) this.spawnMini(i)
        this.growth = scaleForStep(this.journey.growthStep)
        this.detailPlan = detailsForFriend(this.journey.episode, this.journey.friendsFed)
        this.buildMonster()
        this.syncDetails(false)
        this.layout()

        // Fresh round from the (possibly new) episode pool.
        this.previousRequest = undefined
        const round = generateRound({
          round: this.roundNumber,
          skill: this.skill,
          foods: this.episode.foods,
        })
        this.round = round
        this.previousRequest = round.request
        this.eaten = []
        this.spitBacks = 0
        this.roundStartAt = this.time.now
        this.buildTray(round.tray)
        this.showRequest(round.request)
        return true
      },
    }
    this.testApi = api
    window.__feedTheMonster = api
  }

  private teardownTestApi(): void {
    if (this.testApi && window.__feedTheMonster === this.testApi) delete window.__feedTheMonster
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

  /** Smooth closed blob outline: n jittered radii, sampled through midpoints. */
  private blobPoints(cx: number, cy: number, r: number, seed: number): Phaser.Math.Vector2[] {
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

  private makeBlobTexture(key: string, radius: number, color: number, seed: number): void {
    if (this.textures.exists(key)) return
    const side = Math.ceil(radius * 2.4)
    const g = this.add.graphics()
    g.fillStyle(color, 1)
    g.fillPoints(this.blobPoints(side / 2, side / 2, radius, seed), true)
    g.generateTexture(key, side, side)
    g.destroy()
  }

  /** The current friend's body hue (episode × lineup position, stable). */
  private friendBodyColor(): number {
    return friendColor(this.journey.episode, this.journey.friendsFed)
  }

  /** Body blob texture per friend color: blob + darker patch + antenna. */
  private monsterTexture(color: number): string {
    const key = `ftm-monster-${color.toString(16)}`
    if (this.textures.exists(key)) return key
    const r = this.bodyR
    const side = Math.ceil(r * 3)
    const cx = side / 2
    const cy = side / 2 + r * 0.1
    const g = this.add.graphics()
    g.fillStyle(color, 1)
    g.fillRect(cx - r * 0.05, cy - r * 1.24, r * 0.1, r * 0.5)
    g.fillCircle(cx, cy - r * 1.28, r * 0.13)
    g.fillPoints(this.blobPoints(cx, cy, r, 7), true)
    g.fillStyle(darken(color), 1)
    g.fillEllipse(cx - r * 0.2, cy + r * 0.52, r * 1.0, r * 0.42)
    g.generateTexture(key, side, side)
    g.destroy()
    return key
  }

  private makeTextures(): void {
    this.monsterTexture(this.friendBodyColor())

    // Plate under each tray food.
    if (!this.textures.exists('ftm-plate')) {
      const pr = this.px(42)
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(pr, pr, pr)
      g.fillStyle(0xf7e3cd, 1)
      g.fillCircle(pr, pr, pr * 0.72)
      g.generateTexture('ftm-plate', pr * 2, pr * 2)
      g.destroy()
    }

    // Color splash for the task panel tiles (white, tinted per request color).
    this.makeBlobTexture('ftm-splash', this.px(26), 0xffffff, 11)

    // Ban sign for "not" rounds: red ring + diagonal bar (🚫, drawn crisp).
    if (!this.textures.exists('ftm-ban')) {
      const r = this.px(34)
      const stroke = this.px(8)
      const side = r * 2 + stroke * 2
      const g = this.add.graphics()
      g.lineStyle(stroke, 0xe5484d, 1)
      g.strokeCircle(side / 2, side / 2, r)
      const off = r * Math.SQRT1_2
      g.lineBetween(side / 2 - off, side / 2 - off, side / 2 + off, side / 2 + off)
      g.generateTexture('ftm-ban', side, side)
      g.destroy()
    }

    // Particles.
    if (!this.textures.exists('ftm-confetti')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillRoundedRect(0, 0, this.px(12), this.px(9), this.px(3))
      g.generateTexture('ftm-confetti', this.px(12), this.px(9))
      g.destroy()
    }
    if (!this.textures.exists('ftm-dot')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(this.px(6), this.px(6), this.px(6))
      g.generateTexture('ftm-dot', this.px(12), this.px(12))
      g.destroy()
    }
    this.emojiTexture('ftm-star', '⭐', 30)

    // Crown for a fully grown friend (the final growth detail).
    if (!this.textures.exists('ftm-crown')) {
      const w = this.px(66)
      const h = this.px(44)
      const g = this.add.graphics()
      g.fillStyle(0xffd93d, 1)
      g.fillPoints(
        [
          new Phaser.Math.Vector2(0, h),
          new Phaser.Math.Vector2(0, h * 0.25),
          new Phaser.Math.Vector2(w * 0.25, h * 0.62),
          new Phaser.Math.Vector2(w * 0.5, 0),
          new Phaser.Math.Vector2(w * 0.75, h * 0.62),
          new Phaser.Math.Vector2(w, h * 0.25),
          new Phaser.Math.Vector2(w, h),
        ],
        true,
      )
      g.generateTexture('ftm-crown', w, h)
      g.destroy()
    }

    for (const food of this.episode.foods) {
      if (!this.hasArt(`food-${food.id}`))
        this.emojiTexture(`ftm-food-${food.id}`, food.emoji, FOOD_CSS)
    }
  }

  /** Texture for a food: reskin sprite when shipped, emoji strike otherwise. */
  private foodTexture(foodId: string): string {
    return this.hasArt(`food-${foodId}`) ? artKey(`food-${foodId}`) : `ftm-food-${foodId}`
  }

  /**
   * A tray food's resting scale (1 for emoji textures; reskin sprites are
   * normalized down from atlas resolution). All food scale tweens are
   * multiples of this.
   */
  private foodBaseScale(img: Phaser.GameObjects.Image): number {
    return (img.getData('baseScale') as number | undefined) ?? 1
  }

  // ─── Build ───────────────────────────────────────────────────────────────

  /** Build (or rebuild, for the next friend) the feedable monster. */
  private buildMonster(): void {
    if (this.monster) {
      this.tweens.killTweensOf(this.monster)
      this.tweens.killTweensOf(this.monsterBody)
      this.mouthTween?.stop()
      this.mouthState.open = 0
      this.monster.destroy()
    }
    this.detailObjects.clear()

    const color = this.friendBodyColor()
    const spec = friendSpec(this.journey.episode, this.journey.friendsFed)
    const artBody = this.hasArt(spec.art)
    const r = this.bodyR
    this.monster = this.add.container(0, 0).setDepth(2)
    this.monster.setScale(this.growth)

    const shadow = this.add.ellipse(0, r * 1.02, r * 1.5, r * 0.26, 0x000000, 0.12)
    if (artBody) {
      this.monsterBody = this.add.image(0, -r * 0.1, artKey(spec.art))
      this.bodyScale = (r * 2.3) / this.monsterBody.height
    } else {
      this.monsterBody = this.add.image(0, -r * 0.1, this.monsterTexture(color))
      this.bodyScale = 1
    }
    this.monsterBody.setScale(this.bodyScale)
    this.monster.add([shadow, this.monsterBody])

    // Face recipe: big close-set white eyes, pupils that drift toward touch.
    // Always engine-drawn (never baked into body art) so every friend blinks,
    // tracks and chomps the same way; face-eye/face-mouth sprites re-skin it.
    const eyeR = r * 0.2
    const buildEye = (x: number): Phaser.GameObjects.Container => {
      const eye = this.add.container(x, r * spec.faceY)
      const white = this.hasArt('face-eye')
        ? this.add.image(0, 0, artKey('face-eye')).setDisplaySize(eyeR * 2.2, eyeR * 2.2)
        : this.add.ellipse(0, 0, eyeR * 2, eyeR * 2, 0xffffff)
      const pupil = this.add.ellipse(0, 0, eyeR, eyeR, INK)
      eye.add([white, pupil])
      if (x < 0) this.pupilL = pupil
      else this.pupilR = pupil
      return eye
    }
    this.eyeL = buildEye(-r * spec.eyeGap)
    this.eyeR = buildEye(r * spec.eyeGap)

    // Art bodies bake their own blush next to the face patch.
    const blush: Phaser.GameObjects.GameObject[] = artBody
      ? []
      : [
          this.add.ellipse(-r * 0.62, r * 0.08, r * 0.22, r * 0.15, PINK, 0.4),
          this.add.ellipse(r * 0.62, r * 0.08, r * 0.22, r * 0.15, PINK, 0.4),
        ]

    const mouth = this.add.container(0, r * spec.mouthY)
    this.artMouth = this.hasArt('face-mouth')
    if (this.artMouth) {
      const lips = this.add.image(0, 0, artKey('face-mouth'))
      this.mouthBase = { x: (r * 0.9) / lips.width, y: (r * 0.6) / lips.height }
      this.mouthLips = lips
    } else {
      this.mouthLips = this.add.ellipse(0, 0, r * 0.9, r * 0.6, INK)
      this.mouthBase = { x: 1, y: 1 }
    }
    this.mouthTongue = this.add.ellipse(0, r * 0.1, r * 0.5, r * 0.34, PINK)
    this.mouthTongue.setAlpha(0)
    this.mouthTongue.setVisible(!this.artMouth) // sprite mouth bakes the tongue
    mouth.add([this.mouthLips, this.mouthTongue])

    this.nose = this.add.ellipse(0, -r * 0.02, r * 0.22, r * 0.16, darken(color))
    if (artBody) this.nose.setAlpha(0.001) // keep the sneeze hotspot, hide the blot

    this.monster.add([...blush, this.eyeL, this.eyeR, mouth, this.nose])
    this.applyMouth()

    // Idle life: breathe (container scale is reserved for growth/squash).
    this.tweens.add({
      targets: this.monsterBody,
      scaleX: this.bodyScale * 1.03,
      scaleY: this.bodyScale * 1.03,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // Tap the body → giggle. Tap the nose → sneeze (easter egg).
    // Hit shapes live in unscaled frame coords, hence the /bodyScale.
    const frame = this.textures.getFrame(this.monsterBody.texture.key)
    this.monsterBody.setInteractive(
      new Phaser.Geom.Circle(
        frame.width / 2,
        frame.height / 2 + (artBody ? 0 : r * 0.1),
        r / this.bodyScale,
      ),
      Phaser.Geom.Circle.Contains,
    )
    this.monsterBody.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.getDistance() < this.px(10)) this.giggle()
    })
    this.nose.setInteractive(
      new Phaser.Geom.Circle(r * 0.11, r * 0.08, r * 0.24),
      Phaser.Geom.Circle.Contains,
    )
    this.nose.on('pointerdown', () => this.sneeze())
  }

  // ─── Growth details (the friend visibly changes, not just scales) ─────────

  /**
   * Build one growth detail's game objects, in body-local coords: the reskin
   * accessory sprite when shipped (DETAIL_ART), procedural shapes otherwise.
   */
  private buildDetail(kind: DetailKind): Phaser.GameObjects.GameObject[] {
    const r = this.bodyR
    const art = DETAIL_ART[kind]
    if (this.hasArt(art.art)) {
      const img = this.add.image(r * art.x, r * art.y, artKey(art.art))
      img.setScale((r * art.width) / img.width)
      return [img]
    }
    const color = this.friendBodyColor()
    const dark = darken(color, 0.72)
    switch (kind) {
      case 'horns': {
        const horn = (side: -1 | 1) =>
          this.add
            .triangle(
              side * r * 0.52,
              -r * 0.98,
              0,
              r * 0.34,
              r * 0.13,
              0,
              r * 0.26,
              r * 0.34,
              dark,
            )
            .setRotation(side * 0.5)
        return [horn(-1), horn(1)]
      }
      case 'ears': {
        const ear = (side: -1 | 1) => this.add.circle(side * r * 0.78, -r * 0.72, r * 0.19, dark)
        return [ear(-1), ear(1)]
      }
      case 'spots':
        return [
          this.add.circle(-r * 0.38, r * 0.42, r * 0.11, dark, 0.55),
          this.add.circle(r * 0.3, r * 0.58, r * 0.13, dark, 0.55),
          this.add.circle(r * 0.02, r * 0.32, r * 0.08, dark, 0.55),
        ]
      case 'bowtie': {
        const wing = (side: -1 | 1) =>
          this.add.triangle(
            side * r * 0.14,
            r * 0.8,
            0,
            0,
            side * r * 0.24,
            -r * 0.11,
            side * r * 0.24,
            r * 0.11,
            0xe5484d,
          )
        return [wing(-1), wing(1), this.add.circle(0, r * 0.8, r * 0.06, 0xc73840)]
      }
      case 'freckles': {
        const dots: Phaser.GameObjects.GameObject[] = []
        for (const side of [-1, 1] as const) {
          for (let i = 0; i < 3; i++) {
            dots.push(
              this.add.circle(
                side * (r * 0.52 + i * r * 0.09),
                r * 0.14 + (i % 2) * r * 0.07,
                r * 0.028,
                INK,
                0.7,
              ),
            )
          }
        }
        return dots
      }
      case 'crown': {
        const crown = this.add.image(0, -r * 1.0, 'ftm-crown')
        crown.setDisplaySize(r * 0.62, r * 0.4)
        return [crown]
      }
    }
  }

  /**
   * Make the shown details match a growth step (plan prefix): pop in what's
   * newly earned, puff away what shrank off. Defaults to the journey's step;
   * the friend-grown moment passes GROW_STEPS to crown the walker.
   */
  private syncDetails(animated: boolean, step = this.journey.growthStep): void {
    const target = new Set(visibleDetails(this.detailPlan, step))

    for (const [kind, objects] of [...this.detailObjects]) {
      if (target.has(kind)) continue
      this.detailObjects.delete(kind)
      for (const obj of objects) {
        this.tweens.killTweensOf(obj)
        obj.destroy()
      }
      if (animated) {
        const mp = this.monsterPos()
        this.puffs.explode(8, mp.x, mp.y - this.bodyR * this.growth * 0.6)
      }
    }

    for (const kind of target) {
      if (this.detailObjects.has(kind)) continue
      const objects = this.buildDetail(kind)
      this.monster.add(objects)
      this.detailObjects.set(kind, objects)
      if (!animated) continue
      for (const obj of objects) {
        const sprite = obj as Phaser.GameObjects.Shape
        this.tweens.add({
          targets: sprite,
          scaleX: { from: 0, to: sprite.scaleX },
          scaleY: { from: 0, to: sprite.scaleY },
          duration: 380,
          ease: 'Back.easeOut',
        })
      }
      const mp = this.monsterPos()
      this.sparkles.explode(10, mp.x, mp.y - this.bodyR * this.growth * 0.9)
    }
  }

  // ─── Fed-friends lineup + friend/episode transitions ───────────────────────

  /** Sideline slot (alternating stage corners) for the i-th grown friend. */
  private miniSlot(index: number): XY {
    const fractions = [0.09, 0.91, 0.2, 0.8, 0.31]
    return {
      x: this.scale.width * fractions[index % fractions.length],
      y: this.groundY() - this.bodyR * 0.28,
    }
  }

  /** A simplified grown friend for the lineup: body + eyes, gently bobbing. */
  private spawnMini(index: number, episode = this.journey.episode): Phaser.GameObjects.Container {
    const color = friendColor(episode, index)
    const r = this.bodyR
    const slot = this.miniSlot(index)
    const mini = this.add.container(slot.x, slot.y).setDepth(2).setScale(0.3)

    const shadow = this.add.ellipse(0, r * 1.02, r * 1.5, r * 0.26, 0x000000, 0.1)
    const spec = friendSpec(episode, index)
    const body = this.hasArt(spec.art)
      ? this.add
          .image(0, -r * 0.1, artKey(spec.art))
          .setScale((r * 2.3) / this.textures.getFrame(artKey(spec.art)).height)
      : this.add.image(0, -r * 0.1, this.monsterTexture(color))
    const eye = (side: -1 | 1) => {
      const white = this.add.ellipse(side * r * 0.35, -r * 0.42, r * 0.36, r * 0.36, 0xffffff)
      const pupil = this.add.ellipse(side * r * 0.35, -r * 0.42, r * 0.17, r * 0.17, INK)
      return [white, pupil]
    }
    const smile = this.add.ellipse(0, r * 0.34, r * 0.5, r * 0.22, INK)
    const crownArt = DETAIL_ART.crown
    const crown = this.add.image(
      r * crownArt.x,
      r * crownArt.y,
      this.hasArt(crownArt.art) ? artKey(crownArt.art) : 'ftm-crown',
    )
    crown.setDisplaySize(r * 0.62, r * 0.4)
    mini.add([shadow, body, ...eye(-1), ...eye(1), smile, crown])

    // Idle life so the lineup feels alive, staggered per slot.
    this.tweens.add({
      targets: mini,
      y: slot.y - this.px(6),
      duration: 1600 + index * 180,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.minis.push(mini)
    return mini
  }

  /** The grown friend celebrates, walks aside, and the next one hops in. */
  private friendGrownSequence(danceParty: boolean): void {
    const mp = this.monsterPos()
    // Star shower + a proud jump.
    this.stars.explode(16, mp.x, mp.y - this.bodyR * this.growth)
    ;[523, 659, 784, 1047].forEach((freq, i) =>
      this.time.delayedCall(i * 120, () => playTone(freq, 160, 'triangle', 0.1)),
    )
    this.tweens.add({
      targets: this.monster,
      y: mp.y - this.px(50),
      duration: 240,
      yoyo: true,
      ease: 'Quad.easeOut',
    })

    // Walk aside to the lineup slot, shrinking into a mini…
    const grownIndex = danceParty ? FRIENDS_PER_EPISODE - 1 : this.journey.friendsFed - 1
    const episodeAtGrow = this.journey.episode - (danceParty ? 1 : 0)
    const slot = this.miniSlot(grownIndex)
    this.time.delayedCall(900, () => {
      this.tweens.add({
        targets: this.monster,
        x: slot.x,
        y: slot.y,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 700,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          // …swap the walker for a lineup mini and bring in the next friend.
          this.monster.destroy()
          this.detailObjects.clear()
          const mini = this.spawnMini(grownIndex, episodeAtGrow)
          mini.setScale(0)
          this.tweens.add({
            targets: mini,
            scaleX: 0.3,
            scaleY: 0.3,
            duration: 260,
            ease: 'Back.easeOut',
          })
          if (danceParty) this.dancePartySequence()
          else this.nextFriendEnters()
        },
      })
    })
  }

  /** A brand-new small friend hops in from the side. */
  private nextFriendEnters(): void {
    this.growth = scaleForStep(this.journey.growthStep)
    this.detailPlan = detailsForFriend(this.journey.episode, this.journey.friendsFed)
    this.buildMonster()
    this.syncDetails(false)

    const mp = this.monsterPos()
    this.monster.setPosition(this.scale.width + this.bodyR, mp.y)
    this.tweens.add({
      targets: this.monster,
      x: mp.x,
      duration: 600,
      ease: 'Back.easeOut',
      onComplete: () => this.layout(),
    })
    playTone(659, 90, 'sine', 0.08)
    this.time.delayedCall(110, () => playTone(880, 110, 'sine', 0.08))
  }

  /** All five grown friends dance, then the next episode fades in. */
  private dancePartySequence(): void {
    const cx = this.scale.width / 2
    ;[0, 1].forEach((wave) => {
      this.time.delayedCall(wave * 900, () => {
        this.confetti.explode(50, cx * 0.5, this.px(90))
        this.confetti.explode(50, cx * 1.5, this.px(90))
        this.stars.explode(12, cx, this.px(140))
      })
    })
    // Party melody + everyone bounces in a wave, twice.
    ;[523, 659, 784, 659, 880, 784, 1047].forEach((freq, i) =>
      this.time.delayedCall(i * 180, () => playTone(freq, 150, 'triangle', 0.1)),
    )
    this.minis.forEach((mini, i) => {
      this.tweens.add({
        targets: mini,
        y: mini.y - this.px(46),
        delay: i * 130,
        duration: 260,
        yoyo: true,
        repeat: 3,
        ease: 'Quad.easeOut',
      })
      this.tweens.add({
        targets: mini,
        angle: { from: -8, to: 8 },
        delay: i * 130,
        duration: 260,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
        onComplete: () => mini.setAngle(0),
      })
    })

    this.time.delayedCall(2900, () => this.episodeTransition())
  }

  /** Soft white fade → new palette, food pool, fresh lineup, first friend. */
  private episodeTransition(): void {
    const veil = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0xffffff)
      .setOrigin(0)
      .setDepth(90)
      .setAlpha(0)
    this.tweens.add({
      targets: veil,
      alpha: 1,
      duration: 550,
      ease: 'Sine.easeIn',
      onComplete: () => {
        // Behind the veil: swap the world.
        this.episode = episodeFor(this.journey)
        this.makeTextures()
        for (const mini of this.minis) {
          this.tweens.killTweensOf(mini)
          mini.destroy()
        }
        this.minis = []
        this.growth = scaleForStep(this.journey.growthStep)
        this.detailPlan = detailsForFriend(this.journey.episode, this.journey.friendsFed)
        this.buildMonster()
        this.syncDetails(false)
        this.layout()
        ;[659, 784, 988].forEach((freq, i) =>
          this.time.delayedCall(200 + i * 150, () => playTone(freq, 140, 'sine', 0.08)),
        )
        this.tweens.add({
          targets: veil,
          alpha: 0,
          delay: 150,
          duration: 600,
          ease: 'Sine.easeOut',
          onComplete: () => veil.destroy(),
        })
      },
    })
  }

  private buildPlates(): void {
    for (let i = 0; i < TRAY_SIZE; i++) {
      const plate = this.add.image(0, 0, 'ftm-plate').setDepth(4)
      this.dressPlate(plate)
      plate.setInteractive()
      plate.on('pointerdown', () => {
        playTone(659, 45, 'sine', 0.05)
        const baseX = plate.getData('baseSX') as number
        const baseY = plate.getData('baseSY') as number
        this.tweens.killTweensOf(plate)
        this.tweens.add({
          targets: plate,
          scaleX: { from: baseX * 0.92, to: baseX },
          scaleY: { from: baseY * 0.9, to: baseY },
          duration: 220,
          ease: 'Back.easeOut',
        })
      })
      this.plates.push(plate)
    }
  }

  /** Skin one tray slot: the episode's marker sprite, or the plate fallback. */
  private dressPlate(plate: Phaser.GameObjects.Image): void {
    const marker = `marker-${this.episode.id}`
    if (this.hasArt(marker)) {
      if (plate.texture.key !== artKey(marker)) plate.setTexture(artKey(marker))
      plate.setDisplaySize(this.px(104), this.px(52))
    } else {
      if (plate.texture.key !== 'ftm-plate') plate.setTexture('ftm-plate')
      plate.setScale(1, 0.55)
    }
    plate.setData('baseSX', plate.scaleX)
    plate.setData('baseSY', plate.scaleY)
  }

  private buildBubble(): void {
    this.bubble = this.add.container(0, 0).setDepth(6)
    this.panelGfx = this.add.graphics()
    this.bubble.add(this.panelGfx)
    this.drawPanel(this.px(220))
    this.bubble.setScale(0)
  }

  /**
   * (Re)draw the task panel plate at the given width and rebuild its tap
   * target (tapping the panel repeats the request cue). Drawing per request
   * keeps rounded corners crisp at any width; the border is tinted by the
   * episode palette so the panel changes with the world.
   */
  private drawPanel(width: number): void {
    const bh = this.px(PANEL_H_CSS)
    const radius = this.px(26)
    this.panelGfx.clear()
    this.panelGfx.fillStyle(0xffffff, 0.96)
    this.panelGfx.fillRoundedRect(-width / 2, -bh / 2, width, bh, radius)
    this.panelGfx.lineStyle(this.px(5), this.episode.palette.table, 1)
    this.panelGfx.strokeRoundedRect(-width / 2, -bh / 2, width, bh, radius)

    this.panelHit?.destroy()
    this.panelHit = this.add.rectangle(0, 0, width, bh, 0xffffff, 0)
    this.bubble.addAt(this.panelHit, 1) // above the plate, below the tiles
    this.panelHit.setInteractive()
    this.panelHit.on('pointerdown', () => {
      if (this.round) this.playRequestCue(this.round.request)
      this.tweens.killTweensOf(this.bubble)
      this.tweens.add({
        targets: this.bubble,
        scaleX: { from: 0.94, to: 1 },
        scaleY: { from: 0.94, to: 1 },
        duration: 240,
        ease: 'Back.easeOut',
      })
    })
  }

  private buildEmitters(): void {
    this.confetti = this.add.particles(0, 0, 'ftm-confetti', {
      speed: { min: this.px(200), max: this.px(400) },
      angle: { min: 240, max: 300 },
      gravityY: this.px(700),
      lifespan: { min: 1500, max: 2400 },
      scale: { start: 1, end: 0 },
      rotate: { start: 0, end: 360 },
      tint: CONFETTI_TINTS,
      emitting: false,
    })
    this.stars = this.add.particles(0, 0, 'ftm-star', {
      speed: { min: this.px(150), max: this.px(320) },
      angle: { min: 230, max: 310 },
      gravityY: this.px(500),
      lifespan: { min: 1400, max: 2200 },
      scale: { start: 1, end: 0.2 },
      rotate: { start: 0, end: 180 },
      emitting: false,
    })
    this.sparkles = this.add.particles(0, 0, 'ftm-dot', {
      speed: { min: this.px(80), max: this.px(220) },
      lifespan: 450,
      scale: { start: 0.9, end: 0 },
      tint: [0xffd93d, 0xffffff, 0xff8fab],
      emitting: false,
    })
    this.puffs = this.add.particles(0, 0, 'ftm-dot', {
      speed: { min: this.px(60), max: this.px(170) },
      angle: { min: 40, max: 140 },
      lifespan: 550,
      alpha: { start: 0.8, end: 0 },
      scale: { start: 1.2, end: 2.4 },
      emitting: false,
    })
    for (const emitter of [this.confetti, this.stars, this.sparkles, this.puffs]) {
      emitter.setDepth(50)
    }
  }

  private wireInput(): void {
    this.input.dragDistanceThreshold = this.px(8)

    this.input.on(
      'dragstart',
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const img = obj as Phaser.GameObjects.Image
        if (!this.foods.includes(img)) return
        this.tweens.killTweensOf(img)
        this.dragged = img
        img.setDepth(20)
        img.setScale(this.foodBaseScale(img) * 1.15)
        playTone(523, 50, 'sine', 0.06)
      },
    )

    this.input.on(
      'drag',
      (
        _pointer: Phaser.Input.Pointer,
        obj: Phaser.GameObjects.GameObject,
        dragX: number,
        dragY: number,
      ) => {
        const img = obj as Phaser.GameObjects.Image
        if (img !== this.dragged) return
        img.x = dragX
        img.y = dragY
        // Magnetic snap assist + the mouth opens as food approaches.
        const mouth = this.mouthWorld()
        const dist = Phaser.Math.Distance.Between(img.x, img.y, mouth.x, mouth.y)
        if (dist < this.snapRadius()) {
          img.x += (mouth.x - img.x) * 0.3
          img.y += (mouth.y - img.y) * 0.3
          if (this.mouthState.open < 0.9) this.setMouthOpen(1, 120)
        } else if (this.mouthState.open > 0.1) {
          this.setMouthOpen(0, 160)
        }
      },
    )

    this.input.on(
      'dragend',
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const img = obj as Phaser.GameObjects.Image
        if (img !== this.dragged) return
        this.dragged = null
        const mouth = this.mouthWorld()
        const dist = Phaser.Math.Distance.Between(img.x, img.y, mouth.x, mouth.y)
        if (dist < this.snapRadius() && !this.transitioning) {
          this.feed(img)
        } else {
          this.setMouthOpen(0, 160)
          this.returnToTray(img)
        }
      },
    )

    // Taps on empty background sparkle + boop — everything responds.
    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length > 0) return
        this.sparkles.explode(8, pointer.worldX, pointer.worldY)
        playTone(659, 45, 'sine', 0.04)
      },
    )
  }

  // ─── Layout (RESIZE-safe for portrait + landscape) ───────────────────────

  /**
   * Bottom margin under the food row. Raised well clear of the screen's
   * bottom edge — on the iPad, drags that start near the edge trigger the
   * iOS home-indicator gesture and minimize the game.
   */
  private trayMargin(): number {
    return Math.max(this.scale.height * 0.14, this.px(120))
  }

  private trayY(): number {
    return this.scale.height - this.trayMargin()
  }

  /**
   * The invisible line the friends stand on (there is no table anymore —
   * backgrounds are full-bleed scenery, layout owns all positioning).
   */
  private groundY(): number {
    return this.trayY() - this.px(88)
  }

  private slotPos(index: number): XY {
    return {
      x: (this.scale.width * (index + 0.5)) / TRAY_SIZE,
      y: this.trayY(),
    }
  }

  private monsterPos(): XY {
    return { x: this.scale.width / 2, y: this.groundY() - this.bodyR * this.growth * 0.55 }
  }

  private layout(): void {
    const w = this.scale.width
    const h = this.scale.height
    const palette = this.episode.palette

    this.bgGfx.clear()
    this.bgGfx.fillGradientStyle(
      palette.bgTop,
      palette.bgTop,
      palette.bgBottom,
      palette.bgBottom,
      1,
    )
    this.bgGfx.fillRect(0, 0, w, h)

    // Episode backdrop, cover-scaled (center-weighted art crops safely into
    // any aspect ratio); the gradient stays underneath as the fallback.
    const bgArt = `bg-${this.episode.id}`
    if (this.hasArt(bgArt)) {
      const frame = this.textures.getFrame(artKey(bgArt))
      const cover = Math.max(w / frame.width, h / frame.height)
      this.bgImage
        .setTexture(artKey(bgArt))
        .setPosition(w / 2, h / 2)
        .setDisplaySize(frame.width * cover, frame.height * cover)
        .setVisible(true)
    } else {
      this.bgImage.setVisible(false)
    }

    const mp = this.monsterPos()
    this.monster.setPosition(mp.x, mp.y)
    this.positionBubble()

    this.minis.forEach((mini, i) => {
      this.tweens.killTweensOf(mini)
      const slot = this.miniSlot(i)
      mini.setPosition(slot.x, slot.y)
      this.tweens.add({
        targets: mini,
        y: slot.y - this.px(6),
        duration: 1600 + i * 180,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    })

    for (let i = 0; i < this.plates.length; i++) {
      const slot = this.slotPos(i)
      this.dressPlate(this.plates[i]) // episode may have changed the marker
      this.plates[i].setPosition(slot.x, slot.y + this.px(14))
    }
    for (const food of this.foods) {
      if (food === this.dragged) continue
      this.tweens.killTweensOf(food)
      const slot = this.slotPos(food.getData('slot') as number)
      food.setPosition(slot.x, slot.y)
      food.setScale(this.foodBaseScale(food))
    }
  }

  /** The task panel owns the top of the screen, detached from the friend. */
  private positionBubble(): void {
    this.bubble.setPosition(this.scale.width / 2, this.px(PANEL_CENTER_Y_CSS))
  }

  // ─── Mouth helpers ───────────────────────────────────────────────────────

  private mouthWorld(): XY {
    return {
      x: this.monster.x,
      y: this.monster.y + this.bodyR * 0.38 * this.monster.scaleY,
    }
  }

  private noseWorld(): XY {
    return {
      x: this.monster.x,
      y: this.monster.y - this.bodyR * 0.02 * this.monster.scaleY,
    }
  }

  /** Generous drop zone ≥ 1.5× the mouth radius (and never under 90 css px). */
  private snapRadius(): number {
    return Math.max(this.bodyR * 0.75 * this.growth, this.px(90))
  }

  private setMouthOpen(target: number, duration: number): void {
    this.mouthTween?.stop()
    this.mouthTween = this.tweens.add({
      targets: this.mouthState,
      open: target,
      duration,
      ease: 'Quad.easeOut',
      onUpdate: () => this.applyMouth(),
    })
  }

  private applyMouth(): void {
    const open = this.mouthState.open
    this.mouthLips.setScale(
      this.mouthBase.x * (1 + open * 0.15),
      this.mouthBase.y * (0.14 + 0.86 * open),
    )
    if (this.artMouth) return // sprite mouth carries its own tongue
    this.mouthTongue.setAlpha(open)
    this.mouthTongue.setScale(1, 0.4 + 0.6 * open)
  }

  // ─── Round flow ──────────────────────────────────────────────────────────

  private startRound(n: number): void {
    this.roundNumber = n
    this.eaten = []
    this.spitBacks = 0
    this.transitioning = false
    reportLevel(levelForRound(n))
    const round = generateRound({
      round: n,
      skill: this.skill,
      recentKinds: this.recentKinds,
      previous: this.previousRequest,
      foods: this.episode.foods,
    })
    this.round = round
    this.previousRequest = round.request
    this.recentKinds.push(round.taskKind)
    if (this.recentKinds.length > 6) this.recentKinds.shift()
    this.roundStartAt = this.time.now
    this.buildTray(round.tray)
    this.showRequest(round.request)
    this.time.delayedCall(450, () => this.playRequestCue(round.request))
  }

  private buildTray(tray: string[]): void {
    for (const food of this.foods) {
      this.tweens.killTweensOf(food)
      food.destroy()
    }
    this.foods = []
    this.dragged = null

    tray.forEach((foodId, i) => {
      const slot = this.slotPos(i)
      const texKey = this.foodTexture(foodId)
      const img = this.add.image(slot.x, -this.px(80), texKey).setDepth(5)
      img.setData('foodId', foodId)
      img.setData('slot', i)
      const frame = this.textures.getFrame(texKey)
      // Reskin sprites arrive at atlas resolution — normalize them to the
      // emoji footprint; the hit circle stays ~100 css px either way (the
      // shape lives in unscaled frame coords, hence the /base).
      const base =
        texKey === `ftm-food-${foodId}`
          ? 1
          : this.px(FOOD_CSS * 1.12) / Math.max(frame.width, frame.height)
      img.setData('baseScale', base)
      img.setScale(base)
      img.setInteractive(
        new Phaser.Geom.Circle(frame.width / 2, frame.height / 2, this.px(50) / base),
        Phaser.Geom.Circle.Contains,
      )
      this.input.setDraggable(img)

      // Touch-down ack < 100ms; a plain tap (no drag) wiggles + boops.
      img.on('pointerdown', () => {
        if (this.dragged) return
        this.tweens.add({
          targets: img,
          scaleX: base * 0.9,
          scaleY: base * 0.9,
          duration: 80,
          yoyo: true,
          ease: 'Quad.easeOut',
        })
      })
      img.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.getDistance() < this.px(8)) {
          playTone(659, 45, 'sine', 0.05)
          this.wiggle(img)
        }
      })

      // Drop-in: staggered bounce onto the tray.
      this.tweens.add({
        targets: img,
        y: slot.y,
        delay: i * 90,
        duration: 600,
        ease: 'Bounce.easeOut',
      })
      this.foods.push(img)
    })
  }

  private showRequest(request: FoodRequest): void {
    for (const pic of this.bubblePics) {
      this.tweens.killTweensOf(pic)
      pic.destroy()
    }
    this.bubblePics = []
    for (const extra of this.bubbleExtras) extra.destroy()
    this.bubbleExtras = []
    this.pips = []

    const items = bubbleItems(request)
    const itemW = this.px(BUBBLE_ITEM_CSS + 10)
    const bw = items.length * itemW + this.px(52)
    this.drawPanel(bw)

    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    items.forEach((item, i) => {
      const x = (i - (items.length - 1) / 2) * itemW
      let pic: Phaser.GameObjects.Image
      if (item.emoji !== undefined) {
        pic = this.add.image(x, 0, this.foodTexture(this.foodIdForEmoji(item.emoji)))
        pic.setDisplaySize(tile, tile)
      } else if (item.color !== undefined) {
        pic = this.add.image(x, 0, 'ftm-splash').setTint(COLOR_HEX[item.color])
        pic.setDisplaySize(tile, tile)
      } else if (item.dots !== undefined) {
        // Subitizing tile: soft backing splash + domino-style ink pips.
        pic = this.add.image(x, 0, 'ftm-splash').setTint(0xe6dcf7)
        pic.setDisplaySize(tile * 1.1, tile * 1.1)
        this.addPips(x, item.dots)
      } else {
        // Empty slot: pulsing lavender socket (pattern answer / not progress) —
        // tinted so it reads against the white bubble.
        pic = this.add.image(x, 0, 'ftm-splash').setTint(0xcabcea).setAlpha(0.8)
        pic.setDisplaySize(tile * 0.82, tile * 0.82)
        this.tweens.add({
          targets: pic,
          scaleX: pic.scaleX * 1.12,
          scaleY: pic.scaleY * 1.12,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      }
      if (item.banned) {
        const ban = this.add.image(x, 0, 'ftm-ban')
        ban.setDisplaySize(tile * 1.15, tile * 1.15)
        this.bubble.add(ban)
        this.bubbleExtras.push(ban)
      }
      this.bubble.add(pic)
      this.bubblePics.push(pic)
    })
    // Ban overlays must render above their food tile.
    for (const extra of this.bubbleExtras) this.bubble.bringToTop(extra)

    this.tweens.killTweensOf(this.bubble)
    this.bubble.setScale(0)
    this.tweens.add({
      targets: this.bubble,
      scaleX: 1,
      scaleY: 1,
      duration: 320,
      ease: 'Back.easeOut',
    })
  }

  /** Domino-style pip offsets (in pip-spacing units) for 1..6. */
  private static readonly PIP_LAYOUTS: ReadonlyArray<ReadonlyArray<[number, number]>> = [
    [[0, 0]],
    [
      [-1, -1],
      [1, 1],
    ],
    [
      [-1, -1],
      [0, 0],
      [1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [0, 0],
      [-1, 1],
      [1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ],
  ]

  private addPips(tileX: number, count: number): void {
    const layout =
      FeedTheMonsterScene.PIP_LAYOUTS[Math.min(count, FeedTheMonsterScene.PIP_LAYOUTS.length) - 1]
    // Offsets stay well inside the irregular splash blob (radius ~tile/2).
    const unit = this.px(11)
    for (const [ox, oy] of layout) {
      const pip = this.add.circle(tileX + ox * unit, oy * unit, this.px(8), INK)
      this.bubble.add(pip)
      this.bubbleExtras.push(pip)
      this.pips.push(pip)
    }
  }

  /** Light one pip per eaten food — the count lesson replays as feedback. */
  private lightPips(): void {
    this.eaten.forEach((_, i) => {
      const pip = this.pips[i]
      if (!pip || pip.getData('lit')) return
      pip.setData('lit', true)
      pip.setFillStyle(0xffb703)
      this.tweens.add({
        targets: pip,
        scaleX: { from: 1.8, to: 1.2 },
        scaleY: { from: 1.8, to: 1.2 },
        duration: 260,
        ease: 'Back.easeOut',
      })
    })
  }

  /** A correct "not" feed stamps the fed food into the next empty slot. */
  private fillNotSlot(foodId: string): void {
    const pic = this.bubblePics[this.eaten.length]
    if (!pic) return
    this.tweens.killTweensOf(pic)
    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    pic.setTexture(this.foodTexture(foodId))
    pic.setAlpha(1)
    pic.setDisplaySize(tile, tile)
    this.tweens.add({
      targets: pic,
      scaleX: { from: pic.scaleX * 1.4, to: pic.scaleX },
      scaleY: { from: pic.scaleY * 1.4, to: pic.scaleY },
      duration: 240,
      ease: 'Back.easeOut',
    })
  }

  /** The pattern answer lands in the slot and the whole row takes a bow. */
  private fillPatternSlot(): void {
    if (!this.round || this.round.request.kind !== 'pattern') return
    const slot = this.bubblePics[this.bubblePics.length - 1]
    if (!slot) return
    this.tweens.killTweensOf(slot)
    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    slot.setTexture(this.foodTexture(this.round.request.answerId))
    slot.setAlpha(1)
    slot.setDisplaySize(tile, tile)
    // Re-read the completed sequence left-to-right — celebration doubles as
    // the lesson (the pattern is shown whole one more time).
    this.bubblePics.forEach((pic, i) => {
      this.tweens.add({
        targets: pic,
        y: -this.px(12),
        delay: i * 90,
        duration: 150,
        yoyo: true,
        ease: 'Quad.easeOut',
      })
      this.time.delayedCall(i * 90, () => playTone(PENTA[i % PENTA.length], 120, 'sine', 0.08))
    })
  }

  private foodIdForEmoji(emoji: string): string {
    const food = ALL_FOODS.find((f) => f.emoji === emoji)
    return food ? food.id : ALL_FOODS[0].id
  }

  private updateBubbleGray(): void {
    if (!this.round) return
    // not/pattern progress is carried by slot fills, dots by lit pips.
    const kind = this.round.request.kind
    if (kind === 'not' || kind === 'pattern' || kind === 'dots') return
    const grayed = grayedBubbleItems(this.round.request, this.eaten)
    grayed.forEach((isGray, i) => {
      const pic = this.bubblePics[i]
      if (!pic || !isGray || pic.getData('grayed')) return
      pic.setData('grayed', true)
      pic.setTint(0x8d8d8d)
      this.tweens.add({
        targets: pic,
        alpha: 0.35,
        scaleX: pic.scaleX * 0.85,
        scaleY: pic.scaleY * 0.85,
        duration: 220,
        ease: 'Quad.easeOut',
      })
    })
  }

  private playRequestBeeps(count: number): void {
    for (let i = 0; i < Math.min(count, PENTA.length); i++) {
      this.time.delayedCall(i * 170, () => playTone(PENTA[i], 150, 'sine', 0.1))
    }
  }

  /** Audio rendering of the request — each task kind gets its own cue. */
  private playRequestCue(request: FoodRequest): void {
    switch (request.kind) {
      case 'pattern': {
        // The sequence as a melody: one tone per role, then a rising "…?".
        const roles = [...new Set(request.sequence)]
        request.sequence.forEach((id, i) => {
          const tone = PENTA[(roles.indexOf(id) * 2) % PENTA.length]
          this.time.delayedCall(i * 160, () => playTone(tone, 130, 'sine', 0.09))
        })
        this.time.delayedCall(request.sequence.length * 160 + 140, () =>
          playTone(988, 170, 'sine', 0.08),
        )
        return
      }
      case 'not':
        // "Uh-uh" — two low warning taps, then one beep per wanted food.
        playTone(220, 120, 'sine', 0.08)
        this.time.delayedCall(150, () => playTone(196, 140, 'sine', 0.08))
        for (let i = 0; i < Math.min(request.count, PENTA.length); i++) {
          this.time.delayedCall(430 + i * 170, () => playTone(PENTA[i], 150, 'sine', 0.1))
        }
        return
      default:
        this.playRequestBeeps(requestTotal(request))
    }
  }

  // ─── Feeding ─────────────────────────────────────────────────────────────

  private feed(img: Phaser.GameObjects.Image): void {
    img.disableInteractive()
    this.setMouthOpen(1, 80)
    this.tweens.killTweensOf(img)
    const mouth = this.mouthWorld()
    const base = this.foodBaseScale(img)
    this.tweens.add({
      targets: img,
      x: mouth.x,
      y: mouth.y,
      scaleX: base * 0.3,
      scaleY: base * 0.3,
      duration: 130,
      ease: 'Quad.easeIn',
      onComplete: () => this.swallow(img),
    })
  }

  private swallow(img: Phaser.GameObjects.Image): void {
    const foodId = img.getData('foodId') as string
    if (!this.round || this.transitioning) {
      img.destroy()
      return
    }
    if (wantsFood(this.round.request, this.eaten, foodId)) {
      this.eatCorrect(img)
    } else {
      this.spitBack(img)
    }
  }

  private eatCorrect(img: Phaser.GameObjects.Image): void {
    if (!this.round) return
    const foodId = img.getData('foodId') as string
    this.eaten.push(foodId)
    this.foods = this.foods.filter((f) => f !== img)
    img.destroy()

    // Chomp: mouth snaps shut + squash & stretch (volume conserved).
    this.setMouthOpen(0, 70)
    this.tweens.add({
      targets: this.monster,
      scaleX: this.growth * 1.18,
      scaleY: this.growth * 0.84,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => this.monster.setScale(this.growth),
    })

    // Crunch burst, then the ascending count beep (descriptive feedback).
    playTone(196, 70, 'square', 0.08)
    this.time.delayedCall(60, () => playTone(147, 60, 'square', 0.06))
    const step = Math.min(this.eaten.length - 1, PENTA.length - 1)
    this.time.delayedCall(150, () => playTone(PENTA[step], 170, 'sine', 0.12))

    const kind = this.round.request.kind
    if (kind === 'not') this.fillNotSlot(foodId)
    else if (kind === 'dots') this.lightPips()
    else this.updateBubbleGray()

    if (isRoundComplete(this.round.request, this.eaten)) {
      if (kind === 'pattern') this.fillPatternSlot()
      this.completeRound()
    }
  }

  private spitBack(img: Phaser.GameObjects.Image): void {
    // "Blegh" — funny face, head shake, food arcs back to its plate. Never
    // lost, never punished — but it IS the meter's cognitive error signal.
    this.spitBacks++
    playTone(220, 220, 'sine', 0.07)
    this.time.delayedCall(110, () => playTone(165, 180, 'sine', 0.06))
    this.funnyUntil = this.time.now + 700
    this.setMouthOpen(0.45, 90)
    this.time.delayedCall(260, () => this.setMouthOpen(0, 140))
    this.squintEyes()
    this.shakeHead()

    // The friend comically deflates one growth step (never below the start —
    // no-fail), so right/wrong reads directly on the monster's body. Runs
    // after shakeHead(), whose killTweensOf would cancel the deflate tween.
    const shrunk = shrinkStep(this.journey)
    if (shrunk.growthStep !== this.journey.growthStep) {
      this.journey = shrunk
      saveData(GAME_ID, journeyToData(this.journey))
      this.growth = scaleForStep(this.journey.growthStep)
      this.time.delayedCall(60, () => {
        this.tweens.add({
          targets: this.monster,
          scaleX: { from: this.monster.scaleX * 1.06, to: this.growth },
          scaleY: { from: this.monster.scaleY * 0.82, to: this.growth },
          duration: 420,
          ease: 'Bounce.easeOut',
          onComplete: () => this.layout(),
        })
        this.syncDetails(true)
      })
    }

    const slot = this.slotPos(img.getData('slot') as number)
    const base = this.foodBaseScale(img)
    this.arcTo(img, slot.x, slot.y, 550, () => {
      img.setInteractive()
      if (this.transitioning) this.fadeOutFood(img)
    })
    this.tweens.add({
      targets: img,
      scaleX: base,
      scaleY: base,
      duration: 400,
      ease: 'Quad.easeOut',
    })
  }

  private completeRound(): void {
    this.transitioning = true

    // Leftover distractors tumble away.
    this.foods.forEach((food, i) => {
      if (food === this.dragged || this.tweens.isTweening(food)) return
      this.time.delayedCall(150 + i * 40, () => this.fadeOutFood(food))
    })

    // Burp + confetti.
    const mp = this.monsterPos()
    this.time.delayedCall(250, () => {
      playTone(98, 220, 'sawtooth', 0.09)
      this.time.delayedCall(170, () => playTone(78, 190, 'sawtooth', 0.07))
      this.confetti.explode(60, mp.x, mp.y - this.bodyR * this.growth)
    })

    // Round fed = level passed: one persistent star on the launcher tile.
    addStars(GAME_ID)

    // Adaptive nudge: spit-backs and round time steer the cognitive meter,
    // saved every round so the next session resumes near this one.
    this.skill = updateSkill(
      this.skill,
      { spitBacks: this.spitBacks, ms: this.time.now - this.roundStartAt },
      this.skillPeak,
    )
    this.skillPeak = Math.max(this.skillPeak, this.skill)
    saveSkill(GAME_ID, { cognitive: this.skill })

    // The journey advances on care performed: this fed round grows the
    // friend one visible step — or crowns it / completes the episode.
    const { next, outcome } = feedStep(this.journey)
    this.journey = next
    saveData(GAME_ID, journeyToData(this.journey))

    if (outcome === 'grew') {
      // Visible growth pop: clearly bigger + maybe a brand-new detail.
      this.growth = scaleForStep(this.journey.growthStep)
      this.tweens.add({
        targets: this.monster,
        scaleX: this.growth,
        scaleY: this.growth,
        duration: 380,
        ease: 'Back.easeOut',
        onComplete: () => this.layout(),
      })
      this.time.delayedCall(200, () => {
        this.syncDetails(true)
        this.time.delayedCall(300, () =>
          [523, 659, 784].forEach((freq, i) =>
            this.time.delayedCall(i * 120, () => playTone(freq, 160, 'triangle', 0.1)),
          ),
        )
      })
      this.time.delayedCall(1350, () => {
        this.layout()
        this.startRound(this.roundNumber + 1)
      })
      return
    }

    // Fully grown: final size pop + the crown lands on the CURRENT friend
    // (its plan is still active — detailPlan only swaps with the next one).
    this.growth = scaleForStep(GROW_STEPS)
    this.tweens.add({
      targets: this.monster,
      scaleX: this.growth,
      scaleY: this.growth,
      duration: 380,
      ease: 'Back.easeOut',
    })
    this.time.delayedCall(250, () => this.syncDetails(true, GROW_STEPS))

    // Then: walk to the lineup, next friend hops in (and, on the 5th, the
    // dance party + episode change) — then play continues.
    this.time.delayedCall(650, () => this.friendGrownSequence(outcome === 'episode-complete'))
    const advanceAfter = outcome === 'episode-complete' ? 7400 : 3400
    this.time.delayedCall(advanceAfter, () => {
      this.layout()
      this.startRound(this.roundNumber + 1)
    })
  }

  private fadeOutFood(food: Phaser.GameObjects.Image): void {
    if (!food.active) return
    food.disableInteractive()
    this.tweens.killTweensOf(food)
    this.tweens.add({
      targets: food,
      y: food.y + this.px(50),
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.foods = this.foods.filter((f) => f !== food)
        food.destroy()
      },
    })
  }

  private returnToTray(img: Phaser.GameObjects.Image): void {
    const slot = this.slotPos(img.getData('slot') as number)
    const base = this.foodBaseScale(img)
    img.disableInteractive()
    this.arcTo(img, slot.x, slot.y, 450, () => {
      img.setInteractive()
      if (this.transitioning) this.fadeOutFood(img)
    })
    this.tweens.add({
      targets: img,
      scaleX: base,
      scaleY: base,
      duration: 350,
      ease: 'Quad.easeOut',
    })
  }

  /** Move along a little arc (never teleport), with a playful spin. */
  private arcTo(
    img: Phaser.GameObjects.Image,
    toX: number,
    toY: number,
    duration: number,
    onComplete: () => void,
  ): void {
    this.tweens.killTweensOf(img)
    img.setDepth(20)
    const fromX = img.x
    const fromY = img.y
    const peak = Math.min(fromY, toY) - this.px(110)
    const state = { t: 0 }
    this.tweens.add({
      targets: state,
      t: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const t = state.t
        const u = 1 - t
        img.x = fromX + (toX - fromX) * t
        img.y = u * u * fromY + 2 * u * t * peak + t * t * toY
        img.rotation = t * Math.PI * 2
      },
      onComplete: () => {
        if (!img.active) return
        img.setRotation(0)
        img.setDepth(5)
        img.setPosition(toX, toY)
        onComplete()
      },
    })
  }

  // ─── Reactions ───────────────────────────────────────────────────────────

  private wiggle(obj: Phaser.GameObjects.Image): void {
    if (obj === this.dragged || this.tweens.isTweening(obj)) return
    const baseX = obj.x
    this.tweens.add({
      targets: obj,
      x: baseX + this.px(6),
      duration: 60,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => obj.setX(baseX),
    })
  }

  private shakeHead(): void {
    const baseX = this.monsterPos().x
    this.tweens.killTweensOf(this.monster)
    this.monster.setScale(this.growth)
    this.tweens.add({
      targets: this.monster,
      x: baseX + this.px(8),
      duration: 50,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.monster.setX(baseX),
    })
  }

  private squintEyes(): void {
    for (const eye of [this.eyeL, this.eyeR]) {
      this.tweens.killTweensOf(eye)
      this.tweens.add({
        targets: eye,
        scaleY: 0.35,
        duration: 120,
        yoyo: true,
        hold: 350,
        ease: 'Quad.easeOut',
        onComplete: () => eye.setScale(1),
      })
    }
  }

  private giggle(): void {
    // Never during round transitions: killTweensOf would sever the
    // walk-aside/party tween chain that carries the friend sequence.
    if (this.transitioning) return
    playTone(784, 60, 'sine', 0.07)
    this.time.delayedCall(80, () => playTone(880, 70, 'sine', 0.07))
    this.tweens.killTweensOf(this.monster)
    this.monster.setScale(this.growth)
    this.tweens.add({
      targets: this.monster,
      rotation: 0.05,
      duration: 70,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.monster.setRotation(0),
    })
  }

  /** Easter egg: tap the nose → wind-up… ah-CHOO! */
  private sneeze(): void {
    // Same transition guard as giggle(): a mid-walk rebuild would kill the
    // sneeze tween chain and strand `sneezing` forever (no blinks all session).
    if (this.sneezing || this.transitioning) return
    this.sneezing = true
    playTone(660, 130, 'triangle', 0.07)
    for (const eye of [this.eyeL, this.eyeR]) {
      this.tweens.add({ targets: eye, scaleY: 0.1, duration: 200, ease: 'Quad.easeOut' })
    }
    this.tweens.add({
      targets: this.monster,
      scaleX: this.growth * 0.96,
      scaleY: this.growth * 1.1,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => {
        playTone(880, 60, 'triangle', 0.1)
        this.time.delayedCall(70, () => playTone(330, 210, 'triangle', 0.09))
        const nose = this.noseWorld()
        this.puffs.explode(12, nose.x, nose.y)
        this.tweens.add({
          targets: this.monster,
          scaleX: this.growth * 1.14,
          scaleY: this.growth * 0.84,
          duration: 90,
          yoyo: true,
          ease: 'Quad.easeIn',
          onComplete: () => {
            this.monster.setScale(this.growth)
            for (const eye of [this.eyeL, this.eyeR]) eye.setScale(1)
            this.sneezing = false
          },
        })
      },
    })
  }

  private scheduleBlink(): void {
    this.time.delayedCall(3000 + Math.random() * 3000, () => {
      if (!this.sneezing) {
        for (const eye of [this.eyeL, this.eyeR]) {
          if (this.tweens.isTweening(eye)) continue
          this.tweens.add({
            targets: eye,
            scaleY: 0.1,
            duration: 60,
            yoyo: true,
            hold: 40,
            ease: 'Quad.easeIn',
          })
        }
      }
      this.scheduleBlink()
    })
  }

  // ─── Per-frame: pupils track the food / last touch ───────────────────────

  update(): void {
    const pointer = this.input.activePointer
    const target: XY = this.dragged
      ? { x: this.dragged.x, y: this.dragged.y }
      : { x: pointer.worldX, y: pointer.worldY }
    const crossEyed = this.time.now < this.funnyUntil
    const maxOff = this.bodyR * 0.09

    const eyes: Array<[Phaser.GameObjects.Container, Phaser.GameObjects.Ellipse, number]> = [
      [this.eyeL, this.pupilL, 1],
      [this.eyeR, this.pupilR, -1],
    ]
    for (const [eye, pupil, side] of eyes) {
      let dx: number
      let dy: number
      if (crossEyed) {
        dx = side * maxOff * 0.9
        dy = maxOff * 0.5
      } else {
        const m = eye.getWorldTransformMatrix()
        const angle = Math.atan2(target.y - m.ty, target.x - m.tx)
        dx = Math.cos(angle) * maxOff
        dy = Math.sin(angle) * maxOff
      }
      pupil.x += (dx - pupil.x) * 0.18
      pupil.y += (dy - pupil.y) * 0.18
    }
  }
}

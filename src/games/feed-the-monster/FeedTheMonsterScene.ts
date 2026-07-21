import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { reportLevel } from '../../shared/level'
import { addStars, loadProgress, saveData, saveSkill, sessionStart } from '../../shared/progress'
import { onViewportResize, safeAreaInset, viewportSize } from '../../shared/viewport'
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
  auraIntensity,
  darken,
  episodeFor,
  feedStep,
  friendColor,
  journeyFromData,
  journeyToData,
  scaleForStep,
  shrinkStep,
} from './journey'
import type { Episode, JourneyState } from './journey'
import { artEntries, artKey, friendSpec } from './art'
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

// A "want" tile sits ghosted until it is fed, then solidifies + gets a ✓.
const GHOST_ALPHA = 0.5
// Neutral tints for the tiles that are NOT asking for a colour — kept warm-grey
// (never a food colour) so a 3-4yo never reads them as "feed something purple".
const SLOT_GREY = 0xd6d3ce // pattern answer socket — a "?" hole
const DOTS_BACKING = 0xebe7e0 // subitizing frame behind the ink pips

// Per-food visual-scale corrections. Foods are normalized by their max
// dimension, so a compact round shape that fills its footprint in BOTH axes
// reads far heavier than the elongated foods (banana, carrot, cucumber) that
// share the same footprint but are thin. 1 = default; shrink the outliers.
const FOOD_ART_SCALE: Record<string, number> = {
  lemon: 0.8, // big round citrus — dwarfed the thinner foods at full size
}

// The task panel lives at the very top of the screen, in its own bar —
// detached from the friend (was: a thought bubble above the head).
const PANEL_H_CSS = 96
const PANEL_CENTER_Y_CSS = 58

// ─── Responsive vertical layout ────────────────────────────────────────────
// The scene reads on iPad (4:3) AND phone-landscape (~2.2:1), so every vertical
// anchor is a FRACTION of the visible height — the composition scales with the
// screen instead of being pinned by hard px offsets that eat a huge share of a
// short viewport (a fixed 120px bottom margin is 15% of an iPad but 31% of a
// phone in landscape, which used to shove the whole scene up and open a ~36%
// dead band under the tray). Fixed px appears ONLY as physical safe-area
// minimums, never as the primary spacing.
//
// Tray (a fixed-size element) hugs the bottom this fraction up; the hero +
// friends stand a further fraction above the tray, so on every device the tray
// sits at ~81% and the monster at ~48% with matching breathing room.
const TRAY_BOTTOM_FRAC = 0.19
const HERO_GAP_FRAC = 0.26
// The tray never rides closer to the bottom than the home-indicator / notch
// strip plus a food-sprite half-height of clearance (drags that start on the
// very bottom edge trigger the iOS minimize gesture). CSS px, dpr-scaled below.
const TRAY_MIN_CLEARANCE_CSS = 60

// ─── Horizontal tray spread ────────────────────────────────────────────────
// The food row spreads its TRAY_SIZE plates across (1 − 2·SIDE) of the width so
// it uses the screen instead of huddling in the middle 44% with big empty
// gutters. Each plate is sized to its slot minus a small GAP, so plates never
// overlap into one mat and stay individually visible; a max width keeps them
// from dwarfing the food on very wide displays. Food keeps its own comfortable
// size (a touch target for small hands) — only the plates + spacing reflow.
const TRAY_SIDE_FRAC = 0.045
const TRAY_GAP_FRAC = 0.16
const PLATE_MAX_W_CSS = 112

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
  /** Cached iOS safe-area inset (CSS px), refreshed on create + every resize. */
  private safeInsetBottom = 0

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
  private minis: Phaser.GameObjects.Container[] = []

  private bgGfx!: Phaser.GameObjects.Graphics
  private bgImage!: Phaser.GameObjects.Image

  private monster!: Phaser.GameObjects.Container
  /**
   * Breathing/idle-life layer INSIDE monster: body + face + accessories all
   * live here so they animate as one. monster carries growth + chomp/squash +
   * position (it must not also breathe); rig carries the ~3% idle breathe, so
   * the face and worn accessories never float while the body pulses (the old
   * bug: breathe ran on monsterBody alone, its siblings stayed rigid).
   */
  private rig!: Phaser.GameObjects.Container
  private monsterBody!: Phaser.GameObjects.Image
  /** monsterBody's resting scale (art sprites need ≠1; breathe is relative). */
  private bodyScale = 1
  /**
   * Growth aura: a soft glowing halo behind the body whose alpha + scale ramp
   * with the growth step (applyAura). This — plus the ambient sparkles — is how
   * a friend reads as "grown up" now, replacing the old worn accessories. A
   * plain sprite (not a renderer FX), so it behaves identically everywhere.
   * haloFull is its display scale at full size (set per friend in buildMonster).
   */
  private halo!: Phaser.GameObjects.Image
  private haloFull = 1
  private eyeL!: Phaser.GameObjects.Container
  private eyeR!: Phaser.GameObjects.Container
  /** Pupil is a node (dark disc + white catchlight glint) that tracks touch. */
  private pupilL!: Phaser.GameObjects.Container
  private pupilR!: Phaser.GameObjects.Container
  /** White backing + the happy `^` arc — swapped for happy/closed eyes. */
  private eyeWhiteL!: Phaser.GameObjects.Image | Phaser.GameObjects.Ellipse
  private eyeWhiteR!: Phaser.GameObjects.Image | Phaser.GameObjects.Ellipse
  private mouthGiggle: Phaser.GameObjects.Image | null = null
  private happyL: Phaser.GameObjects.Image | null = null
  private happyR: Phaser.GameObjects.Image | null = null
  private happyEyes = false
  private mouthLips!: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Image
  private mouthTongue!: Phaser.GameObjects.Ellipse
  /** Resting closed-smile sprite; crossfades with the open mouth (or null). */
  private mouthSmile: Phaser.GameObjects.Image | null = null
  /** mouthLips' resting scale — applyMouth animates relative to it. */
  private mouthBase = { x: 1, y: 1 }
  private mouthBaseSmile = { x: 1, y: 1 }
  /** True when mouthLips is the face-mouth sprite (tongue is baked in). */
  private artMouth = false
  /** Current friend's horizontal face shift in px (spec.faceX × bodyR). */
  private faceOffX = 0
  /**
   * Current friend's mouth Y offset in px (spec.mouthY × bodyR) — where the
   * mouth is actually DRAWN. The feed/open snap zone (mouthWorld) centers here
   * so it lands on the visible mouth; friends' mouths sit at very different
   * heights (spec.mouthY ranges ≈ −0.5…+0.14), so a fixed offset would bias the
   * zone far below the mouth the child aims at.
   */
  private mouthOffY = 0
  private nose!: Phaser.GameObjects.Ellipse
  /** Lineup minis' pupils (node + its eye container) for pointer tracking. */
  private miniPupils: Array<{
    node: Phaser.GameObjects.Container
    eye: Phaser.GameObjects.Container
  }> = []

  private bubble!: Phaser.GameObjects.Container
  private panelGfx!: Phaser.GameObjects.Graphics
  private panelHit: Phaser.GameObjects.Rectangle | null = null
  private bubblePics: Phaser.GameObjects.Image[] = []
  /** Extra bubble decorations (dot pips, ban overlay) cleared per request. */
  private bubbleExtras: Phaser.GameObjects.GameObject[] = []
  /** Dot pips of a dots round, lit one-by-one as the child feeds. */
  private pips: Phaser.GameObjects.Arc[] = []
  /** Accent ring around the pattern's answer socket (cleared per request). */
  private patternRing: Phaser.GameObjects.Arc | null = null

  private plates: Phaser.GameObjects.Image[] = []
  private foods: Phaser.GameObjects.Image[] = []
  private dragged: Phaser.GameObjects.Image | null = null

  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private stars!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private puffs!: Phaser.GameObjects.Particles.ParticleEmitter
  /** Continuous growth-aura sparkles orbiting the friend (rate ∝ growth). */
  private auraSparkle!: Phaser.GameObjects.Particles.ParticleEmitter

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
    this.safeInsetBottom = safeAreaInset('bottom')
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

    // Restore the fed-friends lineup, no fanfare (buildMonster already lit the
    // current friend's aura to its growth step).
    for (let i = 0; i < this.journey.friendsFed; i++) this.spawnMini(i)

    this.layout()
    this.scheduleBlink()
    // Ambient growth sparkles: a steady tick that emits denser the more grown
    // the current friend is (tickAura reads the live growth each time).
    this.time.addEvent({ delay: 130, loop: true, callback: this.tickAura, callbackScope: this })

    const teardown = (): void => {
      offViewport()
      this.teardownTestApi()
    }
    const offViewport = onViewportResize(this.handleWindowResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
    // React unmount calls game.destroy(), which emits DESTROY (not SHUTDOWN) —
    // without this the viewport listener leaks and fires on a dead scene.
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown)

    // Dev/e2e hook (dev builds, or prod behind `?e2e` / `?dev` — never in
    // normal play). Lets Playwright read state and force a task kind, and
    // backs the `?dev` cheat overlay — the canvas is opaque to the DOM.
    // See testHook.
    if (import.meta.env.DEV || this.urlFlag('e2e') || this.urlFlag('dev')) this.exposeTestApi()

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
        aura: auraIntensity(this.journey.growthStep),
        miniCount: this.minis.length,
      }),
      forceKind: (kind) => {
        if (this.transitioning || !this.round) return false
        this.buildFreshRound({ forceKind: kind, previous: this.previousRequest })
        return true
      },
      forceJourney: (partial) => {
        if (this.transitioning || !this.round) return false
        this.applyJourney(journeyFromData({ ...journeyToData(this.journey), ...partial }))
        return true
      },

      // Dev cheats behind the `?dev` overlay (see FeedDevPanel): nudge one
      // journey axis / re-deal a round for faster manual testing. Each no-ops
      // mid-transition so a celebration's tween chain is never severed.
      devHeroLevel: (delta) => this.devNudgeJourney({ growthStep: delta }),
      devFriends: (delta) => this.devNudgeJourney({ friendsFed: delta }),
      devEpisode: (delta) => this.devNudgeJourney({ episode: delta }),
      devRegenerate: () => {
        if (this.transitioning || !this.round) return
        this.buildFreshRound({ previous: this.previousRequest, recentKinds: this.recentKinds })
      },
    }
    this.testApi = api
    window.__feedTheMonster = api
  }

  private teardownTestApi(): void {
    if (this.testApi && window.__feedTheMonster === this.testApi) delete window.__feedTheMonster
  }

  /**
   * Rebuild the whole world at a journey point (theme, friend, lineup,
   * growth, details) and deal a fresh round from its pool. Shared by the e2e
   * forceJourney hook and the `?dev` overlay nudges.
   */
  private applyJourney(next: JourneyState): void {
    this.journey = next
    saveData(GAME_ID, journeyToData(this.journey))

    this.episode = episodeFor(this.journey)
    this.makeTextures()
    for (const mini of this.minis) {
      this.tweens.killTweensOf(mini)
      mini.destroy()
    }
    this.minis = []
    for (let i = 0; i < this.journey.friendsFed; i++) this.spawnMini(i)
    this.growth = scaleForStep(this.journey.growthStep)
    this.buildMonster()
    this.layout()

    this.previousRequest = undefined
    this.buildFreshRound({})
  }

  /** Nudge one journey axis by delta (clamped to its valid range), rebuild. */
  private devNudgeJourney(delta: Partial<JourneyState>): void {
    if (this.transitioning || !this.round) return
    const next: JourneyState = {
      episode: Math.max(0, this.journey.episode + (delta.episode ?? 0)),
      friendsFed: Phaser.Math.Clamp(
        this.journey.friendsFed + (delta.friendsFed ?? 0),
        0,
        FRIENDS_PER_EPISODE - 1,
      ),
      growthStep: Phaser.Math.Clamp(
        this.journey.growthStep + (delta.growthStep ?? 0),
        0,
        GROW_STEPS - 1,
      ),
    }
    this.applyJourney(next)
  }

  /** Deal a fresh round from the current episode / skill / round number. */
  private buildFreshRound(opts: {
    forceKind?: TaskKind
    previous?: FoodRequest
    recentKinds?: readonly TaskKind[]
  }): void {
    const round = generateRound({
      round: this.roundNumber,
      skill: this.skill,
      recentKinds: opts.recentKinds,
      previous: opts.previous,
      foods: this.episode.foods,
      forceKind: opts.forceKind,
    })
    this.round = round
    this.previousRequest = round.request
    this.eaten = []
    this.spitBacks = 0
    this.roundStartAt = this.time.now
    this.buildTray(round.tray)
    this.showRequest(round.request)
  }

  /** Is `?<name>` present in the URL (top-level search or the hash query)? */
  private urlFlag(name: string): boolean {
    if (new URLSearchParams(location.search).has(name)) return true
    const q = location.hash.indexOf('?')
    return q >= 0 && new URLSearchParams(location.hash.slice(q + 1)).has(name)
  }

  private handleWindowResize = (): void => {
    const vp = viewportSize()
    const w = vp.width * this.dpr
    const h = vp.height * this.dpr
    if (w === this.scale.width && h === this.scale.height) return
    // Re-read the safe-area inset: an orientation change flips which edges the
    // notch/home-indicator occupy, so a landscape↔portrait swap changes it.
    this.safeInsetBottom = safeAreaInset('bottom')
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

  /** Pre-render a bold glyph (e.g. "?") — white with a dark outline so it reads
   * on any slot background (saturated colour, rainbow, or grey). */
  private glyphTexture(key: string, char: string, cssSize: number): void {
    if (this.textures.exists(key)) return
    const fontPx = Math.round(cssSize * this.dpr)
    const pad = Math.ceil(fontPx * 0.32)
    const side = fontPx + pad * 2
    const tex = this.textures.createCanvas(key, side, side)
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

    // "Got it" badge: a white disc + green tick, stamped on collected tiles.
    if (!this.textures.exists('ftm-check')) {
      const r = this.px(15)
      const side = r * 2
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(r, r, r)
      g.lineStyle(this.px(5), 0x2f9e44, 1)
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
    this.glyphTexture('ftm-q', '?', 30)

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

    // Growth-aura halo: a soft radial glow, tinted per friend and scaled/faded
    // by growth in applyAura. A CanvasTexture gradient stays a crisp bloom at
    // any display size (a generated blob would band when scaled up).
    if (!this.textures.exists('ftm-halo')) {
      const rad = this.px(150)
      const size = rad * 2
      const tex = this.textures.createCanvas('ftm-halo', size, size)
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

    for (const food of this.episode.foods) {
      if (!this.hasArt(`food-${food.id}`))
        this.emojiTexture(`ftm-food-${food.id}`, food.emoji, FOOD_CSS)
    }
  }

  /** Texture for a food: reskin sprite when shipped, emoji strike otherwise. */
  private foodTexture(foodId: string): string {
    return this.hasArt(`food-${foodId}`) ? artKey(`food-${foodId}`) : `ftm-food-${foodId}`
  }

  /** Per-food visual-scale correction (evens out oddly-cropped art slices). */
  private foodScale(foodId: string): number {
    return FOOD_ART_SCALE[foodId] ?? 1
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
      this.tweens.killTweensOf(this.rig)
      this.tweens.killTweensOf(this.monsterBody)
      if (this.halo) this.tweens.killTweensOf(this.halo)
      this.mouthTween?.stop()
      this.mouthState.open = 0
      this.happyEyes = false
      this.monster.destroy()
    }

    const color = this.friendBodyColor()
    const spec = friendSpec(this.journey.episode, this.journey.friendsFed)
    const artBody = this.hasArt(spec.art)
    const r = this.bodyR
    this.monster = this.add.container(0, 0).setDepth(2)
    this.monster.setScale(this.growth)
    // rig holds everything that breathes together (halo + body + face); the
    // shadow stays on monster so ground contact never pulses.
    this.rig = this.add.container(0, 0)

    const shadow = this.add.ellipse(0, r * 1.02, r * 1.5, r * 0.26, 0x000000, 0.12)
    // Growth-aura halo, behind the body inside the rig so it grows, breathes
    // and moves as one with the friend. Tinted a lightened body hue; applyAura
    // sets its alpha/scale from the current growth step.
    this.halo = this.add.image(0, -r * 0.1, 'ftm-halo').setTint(this.lighten(color, 0.55))
    this.haloFull = (r * 3.2) / this.halo.width
    this.halo.setScale(this.haloFull)
    this.rig.add(this.halo)
    if (artBody) {
      this.monsterBody = this.add.image(0, -r * 0.1, artKey(spec.art))
      this.bodyScale = (r * 2.3) / this.monsterBody.height
    } else {
      this.monsterBody = this.add.image(0, -r * 0.1, this.monsterTexture(color))
      this.bodyScale = 1
    }
    this.monsterBody.setScale(this.bodyScale)
    this.rig.add(this.monsterBody)
    this.monster.add([shadow, this.rig])

    // Face recipe: big close-set white eyes, pupils that drift toward touch.
    // Always engine-drawn (never baked into body art) so every friend blinks,
    // tracks and chomps the same way; face-eye/face-mouth sprites re-skin it.
    // Off-center face patch (e.g. the fox, whose tail widens the sprite): the
    // whole face shifts by faceX so it lands on the muzzle.
    this.faceOffX = (spec.faceX ?? 0) * r
    this.mouthOffY = spec.mouthY * r
    const fx = this.faceOffX
    const eyeR = r * 0.2
    const buildEye = (side: -1 | 1): Phaser.GameObjects.Container => {
      const eye = this.add.container(fx + side * r * spec.eyeGap, r * spec.faceY)
      const white = this.hasArt('face-eye')
        ? this.add.image(0, 0, artKey('face-eye')).setDisplaySize(eyeR * 2, eyeR * 2)
        : this.add.ellipse(0, 0, eyeR * 2, eyeR * 2, 0xffffff)
      // Pupil node = a big dark disc + a bright catchlight glint. The glint is
      // what turns a blank stare into a warm, alive eye; it rides with the
      // pupil as it tracks the touch.
      const pupil = this.add.container(0, 0)
      const dark = this.add.ellipse(0, 0, eyeR * 1.05, eyeR * 1.05, INK)
      const glint = this.add.circle(-eyeR * 0.28, -eyeR * 0.3, eyeR * 0.24, 0xffffff)
      pupil.add([dark, glint])
      // Happy `^` closed eye for celebration/yum — hidden until toggled.
      // Squashed to ~half its old height (and a touch narrower) so the arc
      // reads as a delicate, thin `^` instead of a heavy chunky wedge.
      const happy = this.hasArt('face-eye-happy')
        ? this.add
            .image(0, 0, artKey('face-eye-happy'))
            .setDisplaySize(eyeR * 2.1, eyeR * 0.75)
            .setVisible(false)
        : null
      eye.add(happy ? [white, pupil, happy] : [white, pupil])
      if (side < 0) {
        this.pupilL = pupil
        this.eyeWhiteL = white
        this.happyL = happy
      } else {
        this.pupilR = pupil
        this.eyeWhiteR = white
        this.happyR = happy
      }
      return eye
    }
    this.eyeL = buildEye(-1)
    this.eyeR = buildEye(1)

    // Art bodies bake their own blush next to the face patch.
    const blush: Phaser.GameObjects.GameObject[] = artBody
      ? []
      : [
          this.add.ellipse(fx - r * 0.62, r * 0.08, r * 0.22, r * 0.15, PINK, 0.4),
          this.add.ellipse(fx + r * 0.62, r * 0.08, r * 0.22, r * 0.15, PINK, 0.4),
        ]

    const mouth = this.add.container(fx, r * spec.mouthY)
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

    // Resting face = a closed smile sprite; the open mouth is only for eating.
    // applyMouth crossfades them so the friend looks content at rest instead of
    // frozen with a flattened/gaping mouth (the old "creepy" resting look).
    if (this.artMouth && this.hasArt('face-mouth-smile')) {
      const smile = this.add.image(0, 0, artKey('face-mouth-smile'))
      // Half the previous height (origin is centered, so it shrinks in place —
      // the smile's vertical center stays put) → a thinner, calmer smile.
      this.mouthBaseSmile = { x: (r * 0.58) / smile.width, y: (r * 0.13) / smile.height }
      smile.setScale(this.mouthBaseSmile.x, this.mouthBaseSmile.y)
      // Sit the resting smile higher than the (lower) open mouth — it reads as
      // a small content smile, and the crossfade to the open mouth then plays
      // as the mouth naturally dropping open to eat.
      smile.setPosition(0, -r * 0.15)
      this.mouthSmile = smile
      mouth.add(smile)
    } else {
      this.mouthSmile = null
    }
    // Wide laugh, shown on happy beats (beHappy) instead of the smile/open.
    if (this.artMouth && this.hasArt('face-mouth-giggle')) {
      const giggle = this.add.image(0, 0, artKey('face-mouth-giggle')).setVisible(false)
      giggle.setScale((r * 0.95) / giggle.width, (r * 0.48) / giggle.height)
      this.mouthGiggle = giggle
      mouth.add(giggle)
    } else {
      this.mouthGiggle = null
    }

    this.nose = this.add.ellipse(fx, -r * 0.02, r * 0.22, r * 0.16, darken(color))
    if (artBody) this.nose.setAlpha(0.001) // keep the sneeze hotspot, hide the blot

    this.rig.add([...blush, this.eyeL, this.eyeR, mouth, this.nose])
    this.applyMouth()

    // Idle life: the whole rig breathes as one, so the halo, body and face
    // pulse together (monster's own scale is reserved for growth/squash — see
    // the rig field note).
    this.tweens.add({
      targets: this.rig,
      scaleX: 1.03,
      scaleY: 1.03,
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

    // Light the aura to this friend's growth step (instant on a fresh build;
    // the grow/shrink pops animate via applyAura(true)).
    this.applyAura(false)
  }

  // ─── Growth aura (the friend "grows up" without any worn accessories) ─────

  /** Blend a hex color toward white by t (0 = unchanged, 1 = white). */
  private lighten(color: number, t: number): number {
    const mix = (c: number): number => Math.round(c + (255 - c) * t)
    return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff)
  }

  /**
   * Push the growth-aura halo to a growth step's intensity (brighter + wider
   * the more grown) — animated for the grow/shrink pop, instant on a rebuild.
   * The fully-grown finale passes GROW_STEPS so the just-completed friend blazes
   * at full before it walks aside to the (also glowing) lineup.
   */
  private applyAura(animated: boolean, step = this.journey.growthStep): void {
    const t = auraIntensity(step)
    const alpha = 0.2 + 0.55 * t
    const scale = this.haloFull * (0.85 + 0.3 * t)
    if (animated) {
      this.tweens.add({
        targets: this.halo,
        alpha,
        scaleX: scale,
        scaleY: scale,
        duration: 420,
        ease: 'Sine.easeOut',
      })
    } else {
      this.halo.setAlpha(alpha).setScale(scale)
    }
  }

  /**
   * One tick of the ambient growth sparkles: a few glints pop on a ring around
   * the friend, denser the more grown it is (rate ∝ auraIntensity). Read off
   * the LIVE monster transform so they track it through growth and the
   * walk-aside; skipped while the walker is torn down between friends.
   */
  private tickAura(): void {
    if (!this.monster || !this.monster.active) return
    const t = auraIntensity(this.journey.growthStep)
    let n = 0
    if (Math.random() < t) n++
    if (Math.random() < t * 0.6) n++
    if (n === 0) return
    const rx = this.bodyR * this.monster.scaleX
    const cy = this.monster.y - this.bodyR * this.monster.scaleY * 0.12
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2
      const rr = rx * (0.6 + Math.random() * 0.5)
      this.auraSparkle.emitParticleAt(
        this.monster.x + Math.cos(angle) * rr,
        cy + Math.sin(angle) * rr * 0.8,
        1,
      )
    }
  }

  // ─── Fed-friends lineup + friend/episode transitions ───────────────────────

  /**
   * Fed friends huddle together as a cozy pile in the bottom-left corner —
   * they overlap and stack (a heap, not a spread-out lineup). Offsets are in
   * bodyR units, anchored to the shared heroBaseline so the pile tracks the
   * hero (and the tray) proportionally on every screen.
   */
  private miniSlot(index: number): XY {
    // dx/dy pile offsets (bodyR units): all friends huddle on one level, each
    // shifted out far enough to partially overlap its neighbour (index 3 sits
    // just right of index 1, index 4 mirrors on the left) — a snug cluster.
    const pile = [
      { dx: 0.0, dy: 0.0 },
      { dx: 0.4, dy: 0.03 },
      { dx: -0.36, dy: 0.05 },
      { dx: 0.72, dy: 0.02 },
      { dx: -0.72, dy: 0.04 },
    ]
    const p = pile[index % pile.length]
    // Extra friends beyond the five slots stack a further tier up (defensive;
    // an episode only ever fills the five slots above).
    const tier = Math.floor(index / pile.length)
    const baseX = Math.max(this.scale.width * 0.1, this.bodyR)
    const baseY = this.heroBaseline() - this.bodyR * 0.28
    return {
      x: baseX + p.dx * this.bodyR,
      y: baseY + (p.dy - tier * 0.6) * this.bodyR,
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
    // Match the walker's face anchors so the lineup mini reads as the same
    // animal (eyes on its own patch, mouth below). Each eye is a container with
    // a pupil node so the mini can idle-glance on its own (scheduleMiniGlance)
    // — alive, but never cursor-tracking (no iPad cursor).
    const fx = (spec.faceX ?? 0) * r // shift the face onto an off-center patch
    const glanceNodes: Phaser.GameObjects.Container[] = []
    const eye = (side: -1 | 1): Phaser.GameObjects.Container => {
      const ec = this.add.container(fx + side * r * spec.eyeGap, r * spec.faceY)
      const white = this.add.ellipse(0, 0, r * 0.34, r * 0.34, 0xffffff)
      const node = this.add.container(0, 0)
      const dark = this.add.ellipse(0, 0, r * 0.2, r * 0.2, INK)
      const glint = this.add.circle(-r * 0.05, -r * 0.06, r * 0.05, 0xffffff)
      node.add([dark, glint])
      ec.add([white, node])
      this.miniPupils.push({ node, eye: ec })
      glanceNodes.push(node)
      return ec
    }
    const smile = this.hasArt('face-mouth-smile')
      ? this.add
          .image(fx, r * spec.mouthY - r * 0.13, artKey('face-mouth-smile'))
          .setDisplaySize(r * 0.55, r * 0.15)
      : this.add.ellipse(fx, r * spec.mouthY - r * 0.13, r * 0.42, r * 0.09, INK)
    // A soft, full-strength halo marks the lineup friend as fully grown — the
    // same growth aura the walker earned, standing in for the old crown. Behind
    // the body, tinted a lightened body hue (art.ts socket rig is gone).
    const halo = this.add.image(0, -r * 0.1, 'ftm-halo').setTint(this.lighten(color, 0.55))
    halo.setDisplaySize(r * 3.2, r * 3.2).setAlpha(0.5)
    mini.add([shadow, halo, body, eye(-1), eye(1), smile])

    // Idle life so the lineup feels alive, staggered per slot.
    this.tweens.add({
      targets: mini,
      y: slot.y - this.px(6),
      duration: 1600 + index * 180,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.scheduleMiniGlance(glanceNodes)

    this.minis.push(mini)
    return mini
  }

  /**
   * A lineup friend idly looks around on its own — both eyes drift together to
   * a gentle random direction (or straight ahead), then re-schedule after a
   * random pause. Independent per mini and untethered from any pointer, so the
   * lineup feels curious and alive on a touch device with no cursor. The chain
   * self-terminates once the mini's pupils are destroyed (rebuild/episode).
   */
  private scheduleMiniGlance(nodes: Phaser.GameObjects.Container[]): void {
    const alive = nodes.filter((n) => n.active)
    if (alive.length === 0) return
    const reach = this.bodyR * 0.06
    const ahead = Math.random() < 0.35
    const angle = Math.random() * Math.PI * 2
    const dx = ahead ? 0 : Math.cos(angle) * reach
    const dy = ahead ? 0 : Math.sin(angle) * reach * 0.7 // less vertical travel
    for (const node of alive) {
      this.tweens.add({ targets: node, x: dx, y: dy, duration: 420, ease: 'Sine.easeInOut' })
    }
    this.time.delayedCall(900 + Math.random() * 1900, () => this.scheduleMiniGlance(nodes))
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
    this.buildMonster()

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
        this.miniPupils = []
        this.growth = scaleForStep(this.journey.growthStep)
        this.buildMonster()
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

  /** Skin one tray slot: the episode's marker sprite, or the plate fallback.
   * Sized to the current slot (plateWidth) so the row reflows responsively. */
  private dressPlate(plate: Phaser.GameObjects.Image): void {
    const w = this.plateWidth()
    const marker = `marker-${this.episode.id}`
    if (this.hasArt(marker)) {
      if (plate.texture.key !== artKey(marker)) plate.setTexture(artKey(marker))
      plate.setDisplaySize(w, w * 0.5) // marker art is a 2:1 doily oval
    } else {
      if (plate.texture.key !== 'ftm-plate') plate.setTexture('ftm-plate')
      plate.setDisplaySize(w, w * 0.55) // procedural plate keeps its flatter oval
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
      // Not during transitions: a mid-celebration replay would hop tiles
      // that the completion bow is already animating.
      if (this.round && !this.transitioning) this.playRequestCue(this.round.request)
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

    // Ambient growth aura: tiny warm glints that drift up off the friend,
    // emitted on a timer (tickAura) at a rate that scales with how grown it is.
    // Sits just above the friend (depth 3) so glints read as its own glow.
    this.auraSparkle = this.add
      .particles(0, 0, 'ftm-dot', {
        speed: { min: this.px(8), max: this.px(40) },
        gravityY: -this.px(24),
        lifespan: { min: 650, max: 1300 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffe9a8, 0xffffff, 0xfff2c2],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(3)
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
   * The iOS home-indicator / notch inset at the bottom edge, in backing px.
   * Drags that begin on the very bottom strip trigger the system minimize
   * gesture, so the tray must clear it; full-bleed canvases don't inherit the
   * inset the way padded DOM does, so we fold it into the layout explicitly.
   */
  private safeBottom(): number {
    return this.safeInsetBottom * this.dpr
  }

  /**
   * Gap between the food row and the screen bottom. Proportional (a share of
   * the height) so it scales with the screen — never a fixed px slab that eats
   * a third of a short landscape phone — but floored by the physical safe-area
   * strip plus a food half-height so the tray always clears the home indicator.
   */
  private bottomMargin(): number {
    return Math.max(
      this.scale.height * TRAY_BOTTOM_FRAC,
      this.safeBottom() + this.px(TRAY_MIN_CLEARANCE_CSS),
    )
  }

  private trayY(): number {
    return this.scale.height - this.bottomMargin()
  }

  /**
   * The invisible line the hero + friends stand on. Anchored a fixed FRACTION
   * of the height ABOVE the tray (not built up from the bottom with px offsets),
   * so the whole cluster tracks the tray proportionally: the phone becomes a
   * scaled copy of the iPad instead of collapsing into the top of the screen.
   */
  private heroBaseline(): number {
    return this.trayY() - this.scale.height * HERO_GAP_FRAC
  }

  /** Width of one tray slot (plate + gap), spreading the row across the width. */
  private traySlotWidth(): number {
    return (this.scale.width * (1 - 2 * TRAY_SIDE_FRAC)) / TRAY_SIZE
  }

  /** Plate marker width: its slot minus a small gap, capped so it can't dwarf
   * the food (nor overlap its neighbour) on very wide screens. */
  private plateWidth(): number {
    return Math.min(this.traySlotWidth() * (1 - TRAY_GAP_FRAC), this.px(PLATE_MAX_W_CSS))
  }

  private slotPos(index: number): XY {
    // Spread the row evenly across the usable width (TRAY_SIDE_FRAC gutter on
    // each side), one plate per slot — so plates fill the screen with small
    // gaps instead of huddling, overlapped, in the middle third.
    const slot = this.traySlotWidth()
    const first = this.scale.width * TRAY_SIDE_FRAC + slot / 2
    return {
      x: first + index * slot,
      y: this.trayY(),
    }
  }

  private monsterPos(): XY {
    const y = this.heroBaseline() - this.bodyR * this.growth * 0.55
    // Never let the head ride up under the top task panel.
    const headroom = this.px(PANEL_CENTER_Y_CSS + PANEL_H_CSS / 2) + this.bodyR * this.growth * 1.35
    return { x: this.scale.width / 2, y: Math.max(y, headroom) }
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
      x: this.monster.x + this.faceOffX * this.monster.scaleX,
      y: this.monster.y + this.mouthOffY * this.monster.scaleY,
    }
  }

  private noseWorld(): XY {
    return {
      x: this.monster.x + this.faceOffX * this.monster.scaleX,
      y: this.monster.y - this.bodyR * 0.02 * this.monster.scaleY,
    }
  }

  /**
   * Generous drop zone, centered on the visible mouth (mouthWorld). Slightly
   * roomier than a tight mouth radius so a 3–4yo who releases a touch above the
   * open mouth still lands the food — the open-mouth cue and the feed test share
   * this exact zone, so "mouth looks open" always means "will feed".
   */
  private snapRadius(): number {
    return Math.max(this.bodyR * 0.9 * this.growth, this.px(100))
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
    if (this.happyEyes && this.mouthGiggle) return // beHappy owns the mouth
    const open = this.mouthState.open
    if (this.mouthSmile) {
      // Hard swap (no alpha crossfade) between the resting smile and the open
      // mouth: the old fade left both mouths partly visible mid-transition,
      // which read as a double-mouth artifact. The open mouth keeps a rounded
      // min shape (scaleY ≥ 0.4) so the instant swap never flashes a flat
      // line; the smooth open/close motion comes from the scaleY ramp below.
      const opening = open > 0.02
      this.mouthSmile.setAlpha(opening ? 0 : 1)
      this.mouthLips.setAlpha(opening ? 1 : 0)
      this.mouthLips.setScale(
        this.mouthBase.x * (1 + open * 0.12),
        this.mouthBase.y * (0.4 + 0.6 * open),
      )
      return
    }
    this.mouthLips.setScale(
      this.mouthBase.x * (1 + open * 0.15),
      this.mouthBase.y * (0.14 + 0.86 * open),
    )
    if (this.artMouth) return // sprite mouth carries its own tongue
    this.mouthTongue.setAlpha(open)
    this.mouthTongue.setScale(1, 0.4 + 0.6 * open)
  }

  /** Toggle the happy `^^` closed eyes (no-op without the sprite). */
  private setHappyEyes(on: boolean): void {
    if (!this.happyL || !this.happyR) return
    this.happyEyes = on
    this.happyL.setVisible(on)
    this.happyR.setVisible(on)
    this.eyeWhiteL.setVisible(!on)
    this.eyeWhiteR.setVisible(!on)
    this.pupilL.setVisible(!on)
    this.pupilR.setVisible(!on)
  }

  /**
   * A burst of pure joy: happy `^^` eyes + the wide laugh mouth, reverting to
   * the resting smile after `ms`. Guards on `.active` so a revert scheduled
   * before a friend rebuild (celebration) never touches a destroyed sprite.
   */
  private beHappy(ms: number): void {
    this.setHappyEyes(true)
    if (this.mouthGiggle) {
      this.mouthSmile?.setVisible(false)
      this.mouthLips.setVisible(false)
      this.mouthGiggle.setVisible(true)
    }
    this.time.delayedCall(ms, () => {
      this.setHappyEyes(false)
      if (this.mouthGiggle?.active) {
        this.mouthGiggle.setVisible(false)
        this.mouthLips.setVisible(true)
        this.mouthSmile?.setVisible(true)
        this.applyMouth()
      }
    })
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
        (texKey === `ftm-food-${foodId}`
          ? 1
          : this.px(FOOD_CSS * 1.12) / Math.max(frame.width, frame.height)) * this.foodScale(foodId)
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
    this.patternRing = null

    // Pattern rounds ask for exactly ONE food (the sequence's continuation),
    // yet their tiles used to look identical to a "feed all of these" combo —
    // the reported early-win confusion. The sequence is drawn as smaller
    // context tiles; the ringed pulsing socket is the only "want". Pattern
    // spacing is wider so the ring never overlaps the last context tile.
    const isPattern = request.kind === 'pattern'
    // Only these kinds run the ghost→solid+✓ "want" flow (updateBubbleGray).
    // dots progress is carried by lit pips, not/pattern by socket fills — their
    // tiles must NOT ghost (e.g. the dots round's food label stays solid).
    const ghostKind = request.kind === 'count' || request.kind === 'color' || request.kind === 'mix'
    const items = bubbleItems(request)
    const itemW = this.px(BUBBLE_ITEM_CSS + (isPattern ? 18 : 10))
    const bw = items.length * itemW + this.px(52)
    this.drawPanel(bw)

    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    items.forEach((item, i) => {
      const x = (i - (items.length - 1) / 2) * itemW
      let pic: Phaser.GameObjects.Image
      // A "want" tile ghosts until it is fed; a "?" marks a you-pick slot; a
      // pattern context tile is drawn already-done (✓ stamped below).
      let ghost = false
      let qSize = 0
      let context = false
      if (item.emoji !== undefined) {
        const fid = this.foodIdForEmoji(item.emoji)
        pic = this.add.image(x, 0, this.foodTexture(fid))
        const size = (isPattern ? tile * 0.78 : tile) * this.foodScale(fid)
        pic.setDisplaySize(size, size)
        // Pattern's shown sequence = given context (reads as done, not a want).
        // A banned food (not-round) stays solid under its ✗. Everything else is
        // a want that ghosts until fed.
        if (isPattern) context = true
        else if (ghostKind && !item.banned) ghost = true
      } else if (item.color !== undefined) {
        pic = this.add.image(x, 0, 'ftm-splash').setTint(COLOR_HEX[item.color])
        pic.setDisplaySize(tile, tile)
        // A banned colour stays solid under its ✗. A colour request is a
        // you-pick slot: keep the hue readable (full tint, semi-transparent)
        // and mark it "any food of this colour" with a ?.
        if (ghostKind && !item.banned) {
          ghost = true
          qSize = tile * 0.5
        }
      } else if (item.dots !== undefined) {
        // Subitizing tile: NEUTRAL backing (never a food colour) + ink pips.
        // Progress is the pips lighting up — no ghost, no ✓.
        pic = this.add.image(x, 0, 'ftm-splash').setTint(DOTS_BACKING)
        pic.setDisplaySize(tile * 1.1, tile * 1.1)
        this.addPips(x, item.dots)
      } else if (isPattern) {
        // The pattern's answer socket — THE ask of the round: a neutral grey
        // "?" hole (never a food colour) with a pulsing ring.
        pic = this.add.image(x, 0, 'ftm-splash').setTint(SLOT_GREY)
        pic.setDisplaySize(tile * 0.9, tile * 0.9)
        const ring = this.add.circle(x, 0, tile * 0.5, 0x000000, 0)
        ring.setStrokeStyle(this.px(4), this.episode.palette.table, 1)
        this.bubble.add(ring)
        this.bubbleExtras.push(ring)
        this.patternRing = ring
        qSize = tile * 0.5
        this.pulse(pic)
      } else {
        // Not-round progress socket — "a food goes here, you pick": the same
        // neutral grey "?" hole as the pattern answer, pulsing until filled.
        // Deliberately makes NO colour claim — the crossed-out tile is the only
        // constraint, so there's no misleading "any colour" wheel (which also
        // showed the banned colour inside a "not that colour" task).
        pic = this.add.image(x, 0, 'ftm-splash').setTint(SLOT_GREY).setAlpha(0.9)
        pic.setDisplaySize(tile * 0.82, tile * 0.82)
        qSize = tile * 0.45
        this.pulse(pic)
      }
      if (ghost) pic.setAlpha(GHOST_ALPHA)
      if (item.banned) {
        const ban = this.add.image(x, 0, 'ftm-ban')
        ban.setDisplaySize(tile * 1.15, tile * 1.15)
        this.bubble.add(ban)
        this.bubbleExtras.push(ban)
      }
      this.bubble.add(pic)
      this.bubblePics.push(pic)
      if (qSize > 0) this.addQ(pic, qSize)
      if (context) this.stampCheck(pic)
    })
    // Overlays (bans, ?, ✓, pips, rings) must render above their tile.
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

  /** Steady breathing pulse — the "act here" cue on you-pick sockets. */
  private pulse(pic: Phaser.GameObjects.Image): void {
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

  /** Overlay a "?" on a you-pick slot ("a food goes here — you choose"). */
  private addQ(pic: Phaser.GameObjects.Image, size: number): void {
    const q = this.add.image(pic.x, pic.y, 'ftm-q')
    q.setDisplaySize(size, size)
    this.bubble.add(q)
    this.bubbleExtras.push(q)
    pic.setData('q', q)
  }

  /** Retire a slot's "?" once the child has supplied the food. */
  private removeQ(pic: Phaser.GameObjects.Image): void {
    const q = pic.getData('q') as Phaser.GameObjects.Image | undefined
    if (!q) return
    pic.setData('q', undefined)
    this.tweens.add({
      targets: q,
      alpha: 0,
      scaleX: q.scaleX * 0.2,
      scaleY: q.scaleY * 0.2,
      duration: 160,
      ease: 'Quad.easeIn',
      onComplete: () => q.destroy(),
    })
  }

  /** Stamp the green "✓ got it" badge on a collected (or given) tile. */
  private stampCheck(pic: Phaser.GameObjects.Image): void {
    if (pic.getData('checked')) return
    pic.setData('checked', true)
    // A soft ✓ disc stamped over the centre of the tile — anchored to the food
    // whatever its shape, translucent so the picture still reads underneath.
    const badge = this.add.image(pic.x, pic.y, 'ftm-check')
    const s = pic.displayWidth * 0.46
    badge.setDisplaySize(s, s).setAlpha(0.85)
    this.bubble.add(badge)
    this.bubbleExtras.push(badge)
    pic.setData('check', badge)
    this.tweens.add({
      targets: badge,
      scaleX: { from: 0, to: badge.scaleX },
      scaleY: { from: 0, to: badge.scaleY },
      duration: 220,
      ease: 'Back.easeOut',
    })
  }

  /** A correct "not" feed stamps the fed food into the next empty slot. */
  private fillNotSlot(foodId: string): void {
    const pic = this.bubblePics[this.eaten.length]
    if (!pic) return
    this.tweens.killTweensOf(pic)
    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    this.removeQ(pic)
    pic.setTexture(this.foodTexture(foodId))
    pic.clearTint()
    pic.setAlpha(1)
    const size = tile * this.foodScale(foodId)
    pic.setDisplaySize(size, size)
    this.tweens.add({
      targets: pic,
      scaleX: { from: pic.scaleX * 1.4, to: pic.scaleX },
      scaleY: { from: pic.scaleY * 1.4, to: pic.scaleY },
      duration: 240,
      ease: 'Back.easeOut',
    })
    this.stampCheck(pic)
  }

  /** The pattern answer lands in the slot and the whole row takes a bow. */
  private fillPatternSlot(): void {
    if (!this.round || this.round.request.kind !== 'pattern') return
    const slot = this.bubblePics[this.bubblePics.length - 1]
    if (!slot) return
    this.tweens.killTweensOf(slot)
    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    this.removeQ(slot)
    slot.setTexture(this.foodTexture(this.round.request.answerId))
    slot.clearTint()
    slot.setAlpha(1)
    const size = tile * this.foodScale(this.round.request.answerId)
    slot.setDisplaySize(size, size)
    this.stampCheck(slot)
    // The socket is answered — its ring bows out.
    if (this.patternRing) {
      this.tweens.killTweensOf(this.patternRing)
      this.tweens.add({ targets: this.patternRing, alpha: 0, duration: 300, ease: 'Quad.easeOut' })
    }
    // Re-read the completed sequence left-to-right — celebration doubles as
    // the lesson (the pattern is shown whole one more time). The ✓ badges ride
    // along with their tiles.
    this.bubblePics.forEach((pic, i) => {
      const targets: Phaser.GameObjects.GameObject[] = [pic]
      const check = pic.getData('check') as Phaser.GameObjects.Image | undefined
      if (check) targets.push(check)
      this.tweens.add({
        targets,
        y: `-=${this.px(12)}`,
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

  /**
   * Mark the just-satisfied want tiles as collected: solidify the ghosted tile
   * with a pop, retire its "?", and stamp the ✓. not/pattern carry progress via
   * slot fills; dots via lit pips — those never run through here.
   */
  private updateBubbleGray(): void {
    if (!this.round) return
    const kind = this.round.request.kind
    if (kind === 'not' || kind === 'pattern' || kind === 'dots') return
    const done = grayedBubbleItems(this.round.request, this.eaten)
    done.forEach((isDone, i) => {
      const pic = this.bubblePics[i]
      if (!pic || !isDone || pic.getData('done')) return
      pic.setData('done', true)
      this.removeQ(pic)
      this.tweens.killTweensOf(pic)
      this.tweens.add({
        targets: pic,
        alpha: 1,
        scaleX: { from: pic.scaleX * 1.18, to: pic.scaleX },
        scaleY: { from: pic.scaleY * 1.18, to: pic.scaleY },
        duration: 240,
        ease: 'Back.easeOut',
      })
      this.stampCheck(pic)
    })
  }

  /** Hop one panel tile (pattern cue re-reads the row tile by tile). */
  private hopBubblePic(index: number): void {
    const pic = this.bubblePics[index]
    if (!pic || !pic.active || this.transitioning) return
    const targets: Phaser.GameObjects.GameObject[] = [pic]
    const check = pic.getData('check') as Phaser.GameObjects.Image | undefined
    if (check) targets.push(check)
    this.tweens.add({
      targets,
      y: `-=${this.px(12)}`,
      duration: 140,
      yoyo: true,
      ease: 'Quad.easeOut',
    })
  }

  /** Flash the pattern answer ring — "this one is missing". */
  private punchPatternRing(): void {
    const ring = this.patternRing
    if (!ring || !ring.active || this.transitioning) return
    this.tweens.killTweensOf(ring)
    ring.setScale(1)
    this.tweens.add({
      targets: ring,
      scaleX: { from: 1.25, to: 1 },
      scaleY: { from: 1.25, to: 1 },
      duration: 320,
      ease: 'Back.easeOut',
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
        // The sequence as a melody, re-taught visually: each context tile
        // hops with its tone, then the answer socket flashes on the rising
        // "…?" — the row leads to the one missing food.
        const roles = [...new Set(request.sequence)]
        request.sequence.forEach((id, i) => {
          const tone = PENTA[(roles.indexOf(id) * 2) % PENTA.length]
          this.time.delayedCall(i * 160, () => {
            playTone(tone, 130, 'sine', 0.09)
            this.hopBubblePic(i)
          })
        })
        this.time.delayedCall(request.sequence.length * 160 + 140, () => {
          playTone(988, 170, 'sine', 0.08)
          this.punchPatternRing()
        })
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
        this.applyAura(true)
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
      this.beHappy(900) // laugh with the confetti (guards its own revert on rebuild)
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
      // Visible growth pop: clearly bigger + a brighter aura.
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
        this.applyAura(true)
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

    // Fully grown: final size pop + the aura blazes to full on the CURRENT
    // friend before it walks aside to join the (glowing) lineup.
    this.growth = scaleForStep(GROW_STEPS)
    this.tweens.add({
      targets: this.monster,
      scaleX: this.growth,
      scaleY: this.growth,
      duration: 380,
      ease: 'Back.easeOut',
    })
    this.time.delayedCall(250, () => this.applyAura(true, GROW_STEPS))

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
    this.beHappy(700)
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
      if (!this.sneezing && !this.happyEyes) {
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
      // The lineup blinks too, each slightly offset so it never looks robotic.
      for (const { eye } of this.miniPupils) {
        if (!eye.active || this.tweens.isTweening(eye)) continue
        this.tweens.add({
          targets: eye,
          scaleY: 0.1,
          duration: 60,
          yoyo: true,
          hold: 40,
          delay: Math.random() * 500,
          ease: 'Quad.easeIn',
        })
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
    // Kept small so a big pupil never spills past the eye white, even when the
    // eye squashes mid-blink.
    const maxOff = this.bodyR * 0.05

    // Only the walker's pupils follow the food/touch (it looks at what it's
    // being fed). Happy `^^` eyes have no pupil to steer — skip them.
    // The lineup friends do NOT track (there is no cursor on the iPad, and
    // constant following looks uncanny) — they idle-glance on their own timers.
    if (!this.happyEyes) {
      const eyes: Array<[Phaser.GameObjects.Container, Phaser.GameObjects.Container, number]> = [
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
}

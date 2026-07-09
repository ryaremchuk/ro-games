import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { clearLevel, reportLevel } from '../../shared/level'
import {
  BALL,
  BASE_GRAVITY_NORM,
  BIRDS,
  BIRD_RADIUS,
  FLAP_NORM,
  FREE_SPEED_NORM,
  GROUND_Y,
  KNOCK_SPEED_NORM,
  MATERIALS,
  MAX_LAUNCH_SPEED_NORM,
  MAX_PULL_NORM,
  MIN_PULL_NORM,
  PIGGY,
  PIGGY_BODY_SCALE,
  SETTLE_SPEED_NORM,
  SLING,
  TRAMPOLINE,
  WOOD_H,
  WOOD_W,
  assistStrength,
  canFreePiggy,
  generateLevel,
  hasReachablePiggy,
  mulberry32,
} from './logic'
import type { BirdKind, BlockMaterial, BlockSpec, LevelSpec, PiggySpec, PropSpec } from './logic'
import { getActiveBird, setActiveBird } from './activeBird'
import { StarDropOverlay } from './StarDropOverlay'
import { rollStarDropTarget, shouldShowStarDrop } from './starDrop'
import { editRequested, emitEditorChange, getEditorApi, registerEditorApi } from './editor/bridge'
import type { AddKind, EditorApi, EditorMode, SelectionKind } from './editor/bridge'
import { clamp, parseLevelSpec, round3 } from './editor/parse'
import type { SlingshotTestApi } from './testHook'

// ART SPEC palette.
const INK = 0x3d3a4b
const SKY_TOP = 0x8fd0ff
const RAINBOW = [0xff6b6b, 0xffa94d, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x9b5de5]

// Physics feel (normalized units; scaled by the resolution unit L at build).
// Contact-speed thresholds live in logic.ts (FREE/KNOCK/SETTLE_SPEED_NORM).
const ASSIST_ACCEL_NORM = 3.0
const SETTLE_S = 0.5
/** Post-entrance grace: no freeing / knock sounds while the level settles. */
const SETTLE_GRACE_MS = 1000
const MAX_FLIGHT_S = 4.5
const POOF_MS = 900
const IDLE_MS = 10000
const TRAJECTORY_DOTS = 16
const TRAJECTORY_DT = 0.055
/** localStorage key for the editor's work-in-progress level draft. */
const EDITOR_DRAFT_KEY = 'ro-games:slingshot-editor-draft'

/** A minimal view of the Matter body fields the scene reads (avoids `any`). */
interface MatterBodyLike {
  id: number
  label: string
  speed: number
  mass: number
  angularVelocity: number
  isSleeping: boolean
  velocity: { x: number; y: number }
  position: { x: number; y: number }
}

interface Block {
  img: Phaser.Physics.Matter.Image
  material: BlockMaterial
  oh: boolean
  wPx: number
  hPx: number
}

interface Piggy {
  img: Phaser.Physics.Matter.Image
  zzz: Phaser.GameObjects.Image
  freed: boolean
  rPx: number
}

interface Bird {
  /** Invisible Matter body (collision + physics only; never scaled). */
  body: Phaser.Physics.Matter.Image
  /** Plain visual that follows the body and carries all squash/stretch. */
  skin: Phaser.GameObjects.Image
  kind: BirdKind
  state: 'loaded' | 'flying' | 'spent'
}

type StaticBody = ReturnType<Phaser.Physics.Matter.Factory['rectangle']>
type Constraint = ReturnType<Phaser.Physics.Matter.Factory['worldConstraint']>

export default class SlingshotScene extends Phaser.Scene {
  private dpr = 1

  // Resolution-independent mapping: normalized [0,1] field → backing pixels.
  private L = 1
  private offX = 0
  private offY = 0

  private level = 1
  private spec!: LevelSpec
  private queueIndex = 0

  // Bodies / entities for the current level.
  private blocks: Block[] = []
  private piggies: Piggy[] = []
  private balls: Phaser.Physics.Matter.Image[] = []
  private trampolines: Phaser.Physics.Matter.Image[] = []
  private seesawPlanks: Phaser.Physics.Matter.Image[] = []
  private bird!: Bird
  private slingPost?: Phaser.GameObjects.Image
  private freedBalloons: Phaser.GameObjects.Image[] = []
  private staticBodies: StaticBody[] = []
  private constraints: Constraint[] = []
  private blockById = new Map<number, Block>()
  private piggyById = new Map<number, Piggy>()
  private trampolineById = new Map<number, Phaser.Physics.Matter.Image>()

  // Graphics layers.
  private bgGfx!: Phaser.GameObjects.Graphics
  private bandGfx!: Phaser.GameObjects.Graphics
  private rainbowGfx!: Phaser.GameObjects.Graphics
  private trajDots: Phaser.GameObjects.Image[] = []

  // Particles.
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private hearts!: Phaser.GameObjects.Particles.ParticleEmitter
  private dustBurst!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter

  // Aiming / flight state.
  private canAim = false
  private aiming = false
  private levelClearing = false
  private dragStart = { x: 0, y: 0 }
  private launchV = { x: 0, y: 0 }
  private lastPullPx = 0
  private forkX = 0
  private forkY = 0
  private flightTime = 0
  private settleTime = 0
  private freedThisFlight = false
  private consecutiveMisses = 0
  private lastInteraction = 0
  private lastCreak = 0
  private lastKnock = 0

  // Zero-input-free guards: piggy freeing arms on the FIRST launch of each
  // level; until then (and during the post-entrance grace) no collision can
  // free a piggy or play knock sounds. Thresholds are px/step, L-scaled at
  // build from the *_NORM constants.
  private freeingArmed = false
  private settleGraceUntil = Infinity
  private freeSpeedPx = 0
  private knockSpeedPx = 0
  private settleSpeedPx = 0

  private dynTextureKeys = new Set<string>()
  private levelTimers: Phaser.Time.TimerEvent[] = []

  // ─── Victory-star reward (Feature 2 — see StarDropOverlay / starDrop.ts) ────
  // After every 3rd cleared level (normal play only) the celebration hands off
  // to a full-screen star-drop overlay above the paused gameplay. `forcedStarDrop`
  // pins the next drop's reward for e2e determinism (else it's rolled fresh).
  private starDrop?: StarDropOverlay
  private starDropPending = false
  private forcedStarDrop: BirdKind | null = null

  // ─── Hidden level editor (adult tool, `#/slingshot?edit`) ──────────────────
  // The editor owns a mutable LevelSpec `draft`; in 'edit' mode the level is
  // built from it with every body static + draggable, in 'play' mode the same
  // draft runs through the normal entrance/physics path for in-place testing.
  private editorOn = false
  private editorMode: EditorMode = 'edit'
  private draft: LevelSpec | null = null
  private editorApi: EditorApi | null = null
  private selected: {
    kind: SelectionKind
    ref: BlockSpec | PiggySpec | PropSpec
    img: Phaser.Physics.Matter.Image
  } | null = null

  constructor() {
    super('slingshot')
  }

  create(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.makeStaticTextures()

    this.bgGfx = this.add.graphics().setDepth(0)
    this.rainbowGfx = this.add.graphics().setDepth(60)
    this.bandGfx = this.add.graphics().setDepth(24)
    this.buildParticles()
    this.buildTrajectory()
    this.wireInput()

    window.addEventListener('resize', this.handleResize)
    window.addEventListener('orientationchange', this.handleResize)
    this.matter.world.on('collisionstart', this.onCollisionStart)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeWindowListeners()
      this.matter.world.off('collisionstart', this.onCollisionStart)
      this.clearTimers()
      this.starDrop?.destroy()
      this.starDrop = undefined
      this.teardownTestApi()
      this.teardownEditorApi()
      clearLevel()
    })
    // React unmount calls game.destroy(), which emits DESTROY (not SHUTDOWN).
    // The window listeners are the only resource Phaser can't reclaim with the
    // scene, so drop them here too — otherwise a stale handleResize fires on a
    // destroyed scene (e.g. an iPad orientation change after leaving the game),
    // and each visit leaks another. removeEventListener is idempotent if both
    // events fire.
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.removeWindowListeners()
      this.starDrop?.destroy()
      this.starDrop = undefined
      this.teardownTestApi()
      this.teardownEditorApi()
    })

    this.editorOn = editRequested()
    if (this.editorOn) {
      this.draft = this.restoreEditorDraft() ?? generateLevel(1, mulberry32(1))
      this.level = this.draft.level
      this.wireEditorInput()
      this.installEditorApi()
    }

    this.buildLevel(this.level)

    // Dev-only e2e hook (tree-shaken from production builds). Lets Playwright
    // read deterministic play state and drive the real aim/release path — Phaser
    // renders to an opaque canvas the DOM can't inspect. See ./testHook.ts.
    if (import.meta.env.DEV || location.search.includes('e2e')) this.exposeTestApi()
  }

  private removeWindowListeners = (): void => {
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('orientationchange', this.handleResize)
  }

  // ─── E2E test hook (dev-only) ──────────────────────────────────────────────

  private testApi?: SlingshotTestApi

  private exposeTestApi(): void {
    const api: SlingshotTestApi = {
      state: () => ({
        level: this.level,
        canAim: this.canAim,
        aiming: this.aiming,
        levelClearing: this.levelClearing,
        birdState: this.bird?.state ?? null,
        birdKind: this.bird?.kind ?? null,
        activeBirdKind: getActiveBird(),
        birdX: this.bird?.body.active ? this.bird.body.x : null,
        birdY: this.bird?.body.active ? this.bird.body.y : null,
        birdAsleep: this.bird?.body.active ? this.bodyOf(this.bird.body).isSleeping : null,
        piggiesTotal: this.piggies.length,
        piggiesFreed: this.piggies.filter((p) => p.freed).length,
        consecutiveMisses: this.consecutiveMisses,
        starDropActive: this.starDrop?.isActive() ?? false,
        starDropTier: this.starDrop?.currentTier() ?? null,
        starDropTapsRemaining: this.starDrop?.tapsLeft() ?? null,
      }),
      flick: (dxN, dyN) => {
        if (!this.canAim || this.aiming || this.levelClearing || this.bird?.state !== 'loaded') {
          return false
        }
        this.aiming = true
        this.dragStart = { x: this.forkX, y: this.forkY }
        const pointer = { x: this.forkX + dxN * this.L, y: this.forkY + dyN * this.L }
        this.updateAim(pointer as unknown as Phaser.Input.Pointer)
        this.release()
        return true
      },
      flap: () => this.flap(),
      // Pin the next star drop's reward (bypasses the weighted roll) so e2e is
      // deterministic. Set before clearing the triggering level.
      forceStarDrop: (kind) => {
        this.forcedStarDrop = kind
      },
      // Jump straight to a level (skips slowly clearing the ones before it), so
      // e2e can reach a star-drop level (multiple of 3) fast. Editor never jumps.
      skipToLevel: (n) => {
        if (this.editorOn) return
        this.buildLevel(Math.max(1, Math.floor(n)))
      },
    }
    this.testApi = api
    window.__slingshot = api
  }

  private teardownTestApi(): void {
    // Identity guard: React StrictMode double-mounts in dev, and Phaser defers
    // destroy() to the next game step — so this scene's late DESTROY can fire
    // *after* the remounted scene has installed its own hook. Only remove ours,
    // never the live one.
    if (this.testApi && window.__slingshot === this.testApi) delete window.__slingshot
  }

  private handleResize = (): void => {
    const w = Math.max(window.innerWidth, 1) * this.dpr
    const h = Math.max(window.innerHeight, 1) * this.dpr
    this.scale.resize(w, h)
    // While the star drop is up, never rebuild the level (that would advance
    // and orphan/duplicate the overlay). Just re-cover the resized screen and
    // re-center the overlay; the level rebuilds when it finishes.
    if (this.starDrop) {
      this.starDrop.relayout()
      return
    }
    // Relayout = rebuild the current level for the new aspect / size. If a
    // resize lands mid-celebration (iOS URL-bar churn, rotation), the rebuild
    // kills the pending auto-advance timer — so advance here instead of
    // silently replaying the level the child just cleared. The editor never
    // advances: its draft is the level. But if a star drop is PENDING (the
    // 2.5s rainbow before the overlay), replay this level so the reward isn't
    // skipped past — the child clears it again and gets the drop.
    if (this.starDropPending && !this.editorOn) {
      this.buildLevel(this.level)
      return
    }
    this.buildLevel(this.levelClearing && !this.editorOn ? this.level + 1 : this.level)
  }

  // ─── Coordinate mapping ────────────────────────────────────────────────────

  private toX(nx: number): number {
    return this.offX + nx * this.L
  }
  private toY(ny: number): number {
    return this.offY + ny * this.L
  }
  private sz(n: number): number {
    return n * this.L
  }
  private px(css: number): number {
    return css * this.dpr
  }

  // ─── Static (size-independent) textures ────────────────────────────────────

  private makeStaticTextures(): void {
    this.emojiTexture('sl-zzz', '💤', 34)
    this.emojiTexture('sl-balloon', '🎈', 64)

    this.graphicsTexture('sl-dot', 20, 20, (g) => {
      g.fillStyle(INK, 0.5)
      g.fillCircle(this.px(6), this.px(6), this.px(5))
    })
    this.graphicsTexture('sl-spark', 20, 20, (g) => {
      g.fillStyle(0xffffff, 1)
      g.fillCircle(this.px(5), this.px(5), this.px(5))
    })
    this.graphicsTexture('sl-confetti', 18, 12, (g) => {
      g.fillStyle(0xffffff, 1)
      g.fillRoundedRect(0, 0, this.px(14), this.px(9), this.px(2))
    })
    this.graphicsTexture('sl-dust', 30, 30, (g) => {
      g.fillStyle(0xffffff, 0.5)
      g.fillCircle(this.px(9), this.px(9), this.px(9))
    })
    this.graphicsTexture('sl-heart', 40, 40, (g) => {
      g.fillStyle(0xff8fab, 1)
      const s = this.px(1)
      g.fillCircle(9 * s, 12 * s, 7 * s)
      g.fillCircle(23 * s, 12 * s, 7 * s)
      g.fillTriangle(2 * s, 15 * s, 30 * s, 15 * s, 16 * s, 32 * s)
    })
  }

  private emojiTexture(key: string, emoji: string, cssSize: number): void {
    if (this.textures.exists(key)) return
    const fontPx = Math.round(cssSize * this.dpr)
    const pad = Math.ceil(fontPx * 0.25)
    const side = fontPx + pad * 2
    const tex = this.textures.createCanvas(key, side, side)
    if (!tex) return
    const ctx = tex.getContext()
    ctx.font = `${fontPx}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(emoji, side / 2, side / 2 + fontPx * 0.03)
    tex.refresh()
  }

  private graphicsTexture(
    key: string,
    wCss: number,
    hCss: number,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): void {
    if (this.textures.exists(key)) return
    const g = this.add.graphics()
    draw(g)
    g.generateTexture(key, this.px(wCss), this.px(hCss))
    g.destroy()
  }

  // ─── Dynamic (L-scaled) textures ───────────────────────────────────────────

  private dyn(
    key: string,
    wPx: number,
    hPx: number,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): void {
    if (this.textures.exists(key)) return
    const g = this.add.graphics()
    draw(g)
    g.generateTexture(key, Math.ceil(wPx), Math.ceil(hPx))
    g.destroy()
    this.dynTextureKeys.add(key)
  }

  private clearDynTextures(): void {
    for (const key of this.dynTextureKeys) {
      if (this.textures.exists(key)) this.textures.remove(key)
    }
    this.dynTextureKeys.clear()
  }

  private blockTextureKey(material: BlockMaterial, wPx: number, hPx: number, oh: boolean): string {
    const key = `sl-blk-${material}-${Math.round(wPx)}x${Math.round(hPx)}-${oh ? 'oh' : 'z'}`
    this.dyn(key, wPx, hPx, (g) => {
      const base = MATERIALS[material].color
      const r = Math.min(wPx, hPx) * 0.18
      g.fillStyle(base, material === 'ice' ? 0.82 : 1)
      g.fillRoundedRect(0, 0, wPx, hPx, r)
      // Texture: wood grain, stone speckles, ice highlight.
      if (material === 'wood') {
        g.lineStyle(Math.max(1, wPx * 0.02), this.shade(base, 0.85), 0.7)
        for (let i = 1; i <= 2; i++) {
          g.beginPath()
          g.moveTo(wPx * 0.15, (hPx * i) / 3)
          g.lineTo(wPx * 0.85, (hPx * i) / 3)
          g.strokePath()
        }
      } else if (material === 'stone') {
        g.fillStyle(this.shade(base, 1.25), 0.8)
        for (let i = 0; i < 5; i++) {
          g.fillCircle(
            wPx * (0.2 + 0.15 * i),
            hPx * (0.3 + 0.12 * (i % 3)),
            Math.max(1, wPx * 0.04),
          )
        }
      } else {
        g.fillStyle(0xffffff, 0.4)
        g.fillRoundedRect(wPx * 0.12, hPx * 0.1, wPx * 0.28, hPx * 0.5, r * 0.6)
      }
      this.drawBlockFace(g, wPx, hPx, oh)
    })
    return key
  }

  private drawBlockFace(
    g: Phaser.GameObjects.Graphics,
    wPx: number,
    hPx: number,
    oh: boolean,
  ): void {
    const cx = wPx / 2
    const cy = hPx * 0.5
    const eye = Math.max(1.5, wPx * 0.05)
    const dx = wPx * 0.16
    g.fillStyle(INK, 0.9)
    if (oh) {
      // Surprised: round open eyes + O mouth.
      g.fillCircle(cx - dx, cy - hPx * 0.08, eye)
      g.fillCircle(cx + dx, cy - hPx * 0.08, eye)
      g.strokeCircle(cx, cy + hPx * 0.16, wPx * 0.1)
      g.lineStyle(Math.max(1.5, wPx * 0.03), INK, 0.9)
      g.strokeCircle(cx, cy + hPx * 0.16, wPx * 0.1)
    } else {
      // Sleepy: two calm closed-eye arcs + tiny smile.
      g.lineStyle(Math.max(1.5, wPx * 0.03), INK, 0.85)
      g.beginPath()
      g.arc(cx - dx, cy - hPx * 0.05, wPx * 0.07, 0.15 * Math.PI, 0.85 * Math.PI)
      g.strokePath()
      g.beginPath()
      g.arc(cx + dx, cy - hPx * 0.05, wPx * 0.07, 0.15 * Math.PI, 0.85 * Math.PI)
      g.strokePath()
      g.beginPath()
      g.arc(cx, cy + hPx * 0.12, wPx * 0.09, 0.1 * Math.PI, 0.9 * Math.PI)
      g.strokePath()
    }
  }

  private birdTexture(kind: BirdKind, rPx: number): string {
    // Key is kind + rounded radius, so a kind rendered at two sizes (or two
    // kinds at one size) never collide — no stale-texture reuse.
    const key = `sl-bird-${kind}-${Math.round(rPx)}`
    const d = rPx * 2
    this.dyn(key, d, d, (g) => {
      const { color } = BIRDS[kind]
      const ex = rPx * 0.32
      const ey = rPx * 0.78
      // Crest / tuft on the crown, drawn first so the head overlaps its base and
      // only the spikes poke out. blue: one jaunty feather; red: a small spiky
      // crest; yellow: a big one. green/purple have a plain crown.
      if (kind === 'blue') this.drawBirdCrest(g, color, rPx, 1, rPx * 0.42, rPx * 0.14)
      else if (kind === 'red') this.drawBirdCrest(g, color, rPx, 2, rPx * 0.34, rPx * 0.12)
      else if (kind === 'yellow') this.drawBirdCrest(g, color, rPx, 3, rPx * 0.5, rPx * 0.15)

      g.fillStyle(this.shade(color, 0.9), 1)
      g.fillEllipse(rPx, rPx * 1.5, rPx * 0.5, rPx * 0.35) // shadow belly
      g.fillStyle(color, 1)
      g.fillCircle(rPx, rPx, rPx * 0.92)
      // Feet.
      g.lineStyle(Math.max(2, rPx * 0.08), 0xffa94d, 1)
      g.beginPath()
      g.moveTo(rPx * 0.7, rPx * 1.8)
      g.lineTo(rPx * 0.7, rPx * 1.95)
      g.moveTo(rPx * 1.3, rPx * 1.8)
      g.lineTo(rPx * 1.3, rPx * 1.95)
      g.strokePath()
      // Eyes (big white with ink pupil).
      g.fillStyle(0xffffff, 1)
      g.fillCircle(rPx - ex, ey, rPx * 0.26)
      g.fillCircle(rPx + ex, ey, rPx * 0.26)
      g.fillStyle(INK, 1)
      g.fillCircle(rPx - ex + rPx * 0.06, ey, rPx * 0.12)
      g.fillCircle(rPx + ex + rPx * 0.06, ey, rPx * 0.12)
      // Beak — orange on the yellow bird (a yellow beak would vanish on it).
      g.fillStyle(kind === 'yellow' ? 0xff922b : 0xffd93d, 1)
      g.fillTriangle(rPx - rPx * 0.14, rPx * 1.05, rPx + rPx * 0.14, rPx * 1.05, rPx, rPx * 1.28)
      // Brows: green/blue none, purple bushy, red angry (steep V), yellow biggest.
      this.drawBirdBrows(g, kind, rPx, ex, ey)
    })
    return key
  }

  /** Spiky crown feathers of a bird, in a darker shade of its body color. */
  private drawBirdCrest(
    g: Phaser.GameObjects.Graphics,
    color: number,
    rPx: number,
    spikes: number,
    len: number,
    halfW: number,
  ): void {
    g.fillStyle(this.shade(color, 0.78), 1)
    const baseY = rPx * 0.14
    for (let i = 0; i < spikes; i++) {
      const cx = rPx + (spikes === 1 ? 0 : (i - (spikes - 1) / 2) * halfW * 1.3)
      g.fillTriangle(cx - halfW, baseY, cx + halfW, baseY, cx + halfW * 0.2, baseY - len)
    }
  }

  /** Per-kind ink brows conveying personality (none / bushy / angry / biggest). */
  private drawBirdBrows(
    g: Phaser.GameObjects.Graphics,
    kind: BirdKind,
    rPx: number,
    ex: number,
    ey: number,
  ): void {
    if (kind === 'green' || kind === 'blue') return
    const bushy = kind === 'purple' || kind === 'yellow'
    const weight = kind === 'yellow' ? 0.12 : bushy ? 0.09 : 0.07
    g.lineStyle(Math.max(2, rPx * weight), INK, 1)
    g.beginPath()
    if (bushy) {
      // Heavy, mildly stern brow: outer-high to inner-low.
      g.moveTo(rPx - ex - rPx * 0.24, ey - rPx * 0.36)
      g.lineTo(rPx - ex + rPx * 0.16, ey - rPx * 0.2)
      g.moveTo(rPx + ex + rPx * 0.24, ey - rPx * 0.36)
      g.lineTo(rPx + ex - rPx * 0.16, ey - rPx * 0.2)
    } else {
      // Angry: steeper V — inner ends dive toward the beak.
      g.moveTo(rPx - ex - rPx * 0.22, ey - rPx * 0.42)
      g.lineTo(rPx - ex + rPx * 0.18, ey - rPx * 0.14)
      g.moveTo(rPx + ex + rPx * 0.22, ey - rPx * 0.42)
      g.lineTo(rPx + ex - rPx * 0.18, ey - rPx * 0.14)
    }
    g.strokePath()
  }

  private piggyTexture(awake: boolean, rPx: number): string {
    const key = `sl-piggy-${awake ? 'awake' : 'asleep'}-${Math.round(rPx)}`
    const d = rPx * 2
    this.dyn(key, d, d, (g) => {
      g.fillStyle(PIGGY.color, 1)
      g.fillCircle(rPx, rPx, rPx * 0.94)
      g.fillStyle(this.shade(PIGGY.color, 0.9), 1)
      g.fillEllipse(rPx, rPx * 1.2, rPx * 0.5, rPx * 0.36) // snout
      g.fillStyle(INK, 0.8)
      g.fillCircle(rPx - rPx * 0.14, rPx * 1.2, rPx * 0.07)
      g.fillCircle(rPx + rPx * 0.14, rPx * 1.2, rPx * 0.07)
      // Ears.
      g.fillStyle(PIGGY.color, 1)
      g.fillTriangle(rPx * 0.4, rPx * 0.4, rPx * 0.75, rPx * 0.3, rPx * 0.55, rPx * 0.72)
      g.fillTriangle(rPx * 1.6, rPx * 0.4, rPx * 1.25, rPx * 0.3, rPx * 1.45, rPx * 0.72)
      const ey = rPx * 0.82
      const ex = rPx * 0.34
      if (awake) {
        g.fillStyle(0xffffff, 1)
        g.fillCircle(rPx - ex, ey, rPx * 0.16)
        g.fillCircle(rPx + ex, ey, rPx * 0.16)
        g.fillStyle(INK, 1)
        g.fillCircle(rPx - ex, ey, rPx * 0.08)
        g.fillCircle(rPx + ex, ey, rPx * 0.08)
      } else {
        g.lineStyle(Math.max(1.5, rPx * 0.06), INK, 0.85)
        for (const sx of [-ex, ex]) {
          g.beginPath()
          g.arc(rPx + sx, ey, rPx * 0.14, 0.12 * Math.PI, 0.88 * Math.PI)
          g.strokePath()
        }
      }
    })
    return key
  }

  private ballTexture(rPx: number): string {
    const key = `sl-ball-${Math.round(rPx)}`
    const d = rPx * 2
    this.dyn(key, d, d, (g) => {
      g.fillStyle(BALL.color, 1)
      g.fillCircle(rPx, rPx, rPx * 0.96)
      g.fillStyle(0xffffff, 0.85)
      // Simple 5-point star.
      const star: Phaser.Math.Vector2[] = []
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2
        const rad = i % 2 === 0 ? rPx * 0.5 : rPx * 0.22
        star.push(new Phaser.Math.Vector2(rPx + Math.cos(a) * rad, rPx + Math.sin(a) * rad))
      }
      g.fillPoints(star, true)
      g.fillStyle(0xffffff, 0.35)
      g.fillCircle(rPx * 0.6, rPx * 0.6, rPx * 0.22)
    })
    return key
  }

  private trampolineTexture(wPx: number): string {
    const hPx = wPx * 0.7
    const key = `sl-tramp-${Math.round(wPx)}`
    this.dyn(key, wPx, hPx, (g) => {
      g.fillStyle(this.shade(TRAMPOLINE.color, 0.85), 1)
      g.fillRoundedRect(wPx * 0.35, hPx * 0.45, wPx * 0.3, hPx * 0.55, wPx * 0.06) // stalk
      g.fillStyle(TRAMPOLINE.color, 1)
      g.fillEllipse(wPx * 0.5, hPx * 0.4, wPx, hPx * 0.75)
      g.fillStyle(0xffffff, 0.6)
      g.fillCircle(wPx * 0.32, hPx * 0.3, wPx * 0.06)
      g.fillCircle(wPx * 0.62, hPx * 0.24, wPx * 0.05)
    })
    return key
  }

  private plankTexture(wPx: number, hPx: number): string {
    const key = `sl-plank-${Math.round(wPx)}x${Math.round(hPx)}`
    this.dyn(key, wPx, hPx, (g) => {
      g.fillStyle(MATERIALS.wood.color, 1)
      g.fillRoundedRect(0, 0, wPx, hPx, hPx * 0.4)
      g.fillStyle(0x9b5de5, 1)
      g.fillCircle(wPx / 2, hPx / 2, hPx * 0.4) // pivot cap
    })
    return key
  }

  private postTexture(wPx: number, hPx: number): string {
    const key = `sl-post-${Math.round(wPx)}x${Math.round(hPx)}`
    this.dyn(key, wPx, hPx, (g) => {
      const arm = wPx * 0.22
      g.fillStyle(this.shade(MATERIALS.wood.color, 0.8), 1)
      g.fillRoundedRect(wPx / 2 - arm / 2, hPx * 0.3, arm, hPx * 0.7, arm * 0.4) // trunk
      g.fillRoundedRect(wPx * 0.1, 0, arm, hPx * 0.5, arm * 0.4) // left fork
      g.fillRoundedRect(wPx * 0.9 - arm, 0, arm, hPx * 0.5, arm * 0.4) // right fork
    })
    return key
  }

  private shade(color: number, factor: number): number {
    const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor))
    const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor))
    const b = Math.min(255, Math.round((color & 0xff) * factor))
    return (r << 16) | (g << 8) | b
  }

  // ─── Particles / trajectory ────────────────────────────────────────────────

  private buildParticles(): void {
    this.confetti = this.add
      .particles(0, 0, 'sl-confetti', {
        speed: { min: this.px(120), max: this.px(320) },
        gravityY: this.px(600),
        lifespan: { min: 900, max: 1500 },
        scale: { start: 1.1, end: 0.2 },
        rotate: { start: 0, end: 360 },
        tint: RAINBOW,
        emitting: false,
      })
      .setDepth(58)
    this.hearts = this.add
      .particles(0, 0, 'sl-heart', {
        speed: { min: this.px(60), max: this.px(160) },
        angle: { min: 250, max: 290 },
        gravityY: this.px(200),
        lifespan: { min: 900, max: 1400 },
        scale: { start: 0.9, end: 0.1 },
        alpha: { start: 1, end: 0 },
        emitting: false,
      })
      .setDepth(58)
    this.dustBurst = this.add
      .particles(0, 0, 'sl-dust', {
        speed: { min: this.px(40), max: this.px(140) },
        lifespan: { min: 500, max: 900 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.6, end: 0 },
        tint: 0xdccdb0,
        emitting: false,
      })
      .setDepth(20)
    this.sparkles = this.add
      .particles(0, 0, 'sl-spark', {
        speed: { min: this.px(60), max: this.px(180) },
        lifespan: 420,
        scale: { start: 0.8, end: 0 },
        tint: [0xffd93d, 0xffffff, 0xff8fab],
        emitting: false,
      })
      .setDepth(58)
  }

  private buildTrajectory(): void {
    for (let i = 0; i < TRAJECTORY_DOTS; i++) {
      this.trajDots.push(this.add.image(0, 0, 'sl-dot').setDepth(23).setVisible(false))
    }
  }

  // ─── Level build / teardown ────────────────────────────────────────────────

  private buildLevel(level: number): void {
    // Defensive: a rebuild while the overlay is somehow still up (e.g. an editor
    // import) must not leave it orphaned above the fresh level.
    if (this.starDrop) {
      this.starDrop.destroy()
      this.starDrop = undefined
    }
    this.starDropPending = false
    this.clearLevelObjects()
    this.level = Math.max(1, level)
    // Editor builds from its mutable draft; normal play from the generator.
    // The badge stays hidden in the editor (reportLevel drives child-facing UI).
    this.spec =
      this.editorOn && this.draft ? this.draft : generateLevel(this.level, mulberry32(this.level))
    if (!this.editorOn) reportLevel(this.level)

    const w = this.scale.width
    const h = this.scale.height
    this.L = Math.min(w, h)
    this.offX = (w - this.L) / 2
    this.offY = h - this.L

    // Gravity: field-units/s² → Matter gravity.y (scale 0.001, engine at 60fps).
    const gy = (BASE_GRAVITY_NORM * this.spec.gravityScale * this.L) / 1000
    this.matter.world.setGravity(0, gy)

    // Contact thresholds: field-units/s → px/step (Matter speeds are px/step).
    this.freeSpeedPx = (FREE_SPEED_NORM * this.L) / 60
    this.knockSpeedPx = (KNOCK_SPEED_NORM * this.L) / 60
    this.settleSpeedPx = (SETTLE_SPEED_NORM * this.L) / 60

    this.drawBackground()
    this.buildBounds()
    this.buildSling()
    this.buildStructures()
    this.buildProps()

    this.levelClearing = false
    this.freedThisFlight = false
    this.consecutiveMisses = 0
    this.freeingArmed = false
    this.settleGraceUntil = Infinity
    this.queueIndex = 0
    this.canAim = false
    this.lastInteraction = this.time.now

    if (this.isEditing()) {
      // Editor layout: no bird, no entrance, every body static + draggable.
      this.enterEditLayout()
      return
    }

    this.loadBird(this.birdQueue()[0])

    // "Blocks drop into place": everything stays static + fades in, then wakes.
    this.staggerEntrance()
  }

  private clearLevelObjects(): void {
    this.tweens.killAll()
    this.clearTimers()
    this.aiming = false
    this.selected = null
    this.hideTrajectory()
    this.bandGfx?.clear()
    this.rainbowGfx?.clear()

    for (const c of this.constraints) this.matter.world.removeConstraint(c)
    this.constraints = []
    for (const b of this.staticBodies) this.matter.world.remove(b)
    this.staticBodies = []

    const kill = (img?: Phaser.GameObjects.GameObject) => img?.destroy()
    for (const b of this.blocks) kill(b.img)
    for (const p of this.piggies) {
      kill(p.img)
      kill(p.zzz)
    }
    for (const b of this.balls) kill(b)
    for (const t of this.trampolines) kill(t)
    for (const s of this.seesawPlanks) kill(s)
    // Freed piggies float off on balloons; a rebuild mid-float would kill the
    // float tween (killAll above) and orphan the balloon — destroy them here.
    for (const b of this.freedBalloons) kill(b)
    this.freedBalloons = []
    kill(this.slingPost)
    this.slingPost = undefined
    if (this.bird) {
      kill(this.bird.body)
      kill(this.bird.skin)
      // Drop the stale reference: the editor's buildLevel skips loadBird, so a
      // leftover mid-flight bird would make update()'s flying branch read a
      // destroyed Matter body (undefined .speed) and kill the RAF loop.
      this.bird = undefined as unknown as Bird
    }

    this.blocks = []
    this.piggies = []
    this.balls = []
    this.trampolines = []
    this.seesawPlanks = []
    this.blockById.clear()
    this.piggyById.clear()
    this.trampolineById.clear()
    this.clearDynTextures()
  }

  private clearTimers(): void {
    for (const t of this.levelTimers) t.remove(false)
    this.levelTimers = []
  }

  private delay(ms: number, fn: () => void): void {
    this.levelTimers.push(this.time.delayedCall(ms, fn))
  }

  private drawBackground(): void {
    const w = this.scale.width
    const h = this.scale.height
    this.bgGfx.clear()
    if (this.spec.theme === 'moon') {
      this.bgGfx.fillGradientStyle(0x141326, 0x141326, 0x2a2740, 0x2a2740, 1)
      this.bgGfx.fillRect(0, 0, w, h)
      // Procedural stars (seeded so they don't twinkle-jump on rebuild).
      const rng = mulberry32(this.level * 97 + 7)
      this.bgGfx.fillStyle(0xffffff, 0.9)
      for (let i = 0; i < 60; i++) {
        this.bgGfx.fillCircle(rng() * w, rng() * h * 0.8, this.px(1 + rng() * 1.6))
      }
    } else {
      this.bgGfx.fillGradientStyle(SKY_TOP, SKY_TOP, 0xdff3ff, 0xdff3ff, 1)
      this.bgGfx.fillRect(0, 0, w, h)
      // Soft hills behind the ground line.
      const gy = this.toY(GROUND_Y)
      this.bgGfx.fillStyle(0xbfe8c8, 1)
      this.bgGfx.fillEllipse(w * 0.3, gy + this.sz(0.1), w * 0.9, this.sz(0.4))
      this.bgGfx.fillEllipse(w * 0.8, gy + this.sz(0.1), w * 0.8, this.sz(0.32))
    }
    // Ground strip.
    const groundY = this.toY(GROUND_Y)
    this.bgGfx.fillStyle(this.spec.theme === 'moon' ? 0x3b3a55 : 0x8fd6a0, 1)
    this.bgGfx.fillRect(0, groundY, w, h - groundY)
    this.bgGfx.fillStyle(this.spec.theme === 'moon' ? 0x4a4968 : 0x7ac48c, 1)
    this.bgGfx.fillRect(0, groundY, w, this.sz(0.012))
  }

  private buildBounds(): void {
    const w = this.scale.width
    const h = this.scale.height
    const groundY = this.toY(GROUND_Y)
    const t = this.sz(0.3)
    const floor = this.matter.add.rectangle(w / 2, groundY + t / 2, w * 2, t, {
      isStatic: true,
      label: 'ground',
      friction: 0.9,
    })
    const left = this.matter.add.rectangle(-t / 2, h / 2, t, h * 3, {
      isStatic: true,
      label: 'wall',
    })
    const right = this.matter.add.rectangle(w + t / 2, h / 2, t, h * 3, {
      isStatic: true,
      label: 'wall',
    })
    const ceiling = this.matter.add.rectangle(w / 2, this.offY - this.sz(0.6), w * 2, t, {
      isStatic: true,
      label: 'wall',
    })
    this.staticBodies.push(floor, left, right, ceiling)
  }

  private buildSling(): void {
    this.forkX = this.toX(SLING.x)
    this.forkY = this.toY(SLING.y)
    const postW = this.sz(0.11)
    const postH = this.toY(GROUND_Y) - this.forkY + this.sz(0.02)
    const key = this.postTexture(postW, postH)
    this.slingPost = this.add
      .image(this.forkX, this.forkY + postH / 2 - this.sz(0.02), key)
      .setDepth(22)
      .setOrigin(0.5, 0.5)
  }

  private buildStructures(): void {
    for (const b of this.spec.blocks) this.addBlock(b)
    for (const p of this.spec.piggies) this.addPiggy(p)
  }

  private addBlock(spec: BlockSpec): void {
    const wPx = this.sz(spec.w)
    const hPx = this.sz(spec.h)
    const key = this.blockTextureKey(spec.material, wPx, hPx, false)
    this.blockTextureKey(spec.material, wPx, hPx, true) // pre-bake the "oh" face
    const img = this.matter.add.image(this.toX(spec.x), this.toY(spec.y), key, undefined, {
      label: 'block',
      density: MATERIALS[spec.material].density,
      friction: MATERIALS[spec.material].friction,
      restitution: MATERIALS[spec.material].restitution,
    })
    img.setAngle(Phaser.Math.RadToDeg(spec.angle))
    img.setStatic(true).setAlpha(0).setDepth(14)
    const block: Block = { img, material: spec.material, oh: false, wPx, hPx }
    this.blocks.push(block)
    this.blockById.set(this.bodyOf(img).id, block)
    img.setData('kind', 'block').setData('ref', spec)

    img.setInteractive()
    img.on('pointerdown', () => {
      if (this.isEditing()) return // editor: taps select, they don't play
      this.bump()
      // Tint toward warm yellow (multiply can only darken) for a tap flash.
      img.setTint(0xfff0b0)
      this.delay(110, () => img.clearTint())
      this.sparkles.explode(4, img.x, img.y)
      playTone(200, 60, 'square', 0.05)
    })
  }

  private addPiggy(spec: PiggySpec): void {
    const rPx = this.sz(PIGGY.radius)
    const key = this.piggyTexture(false, rPx)
    this.piggyTexture(true, rPx)
    const img = this.matter.add.image(this.toX(spec.x), this.toY(spec.y), key, undefined, {
      label: 'piggy',
      density: PIGGY.density,
      friction: PIGGY.friction,
      restitution: PIGGY.restitution,
    })
    img.setCircle(rPx * PIGGY_BODY_SCALE, { label: 'piggy' })
    img.setDensity(PIGGY.density).setFriction(PIGGY.friction).setBounce(PIGGY.restitution)
    img.setStatic(true).setAlpha(0).setDepth(16)
    const zzz = this.add
      .image(img.x, img.y - rPx * 1.4, 'sl-zzz')
      .setDepth(17)
      .setAlpha(0)
    const piggy: Piggy = { img, zzz, freed: false, rPx }
    this.piggies.push(piggy)
    this.piggyById.set(this.bodyOf(img).id, piggy)
    img.setData('kind', 'piggy').setData('ref', spec)
    this.tweens.add({
      targets: zzz,
      y: img.y - rPx * 2.1,
      alpha: { from: 0.9, to: 0.2 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    img.setInteractive()
    img.on('pointerdown', () => {
      if (this.isEditing()) return // editor: taps select, they don't play
      if (piggy.freed) return
      this.bump()
      playTone(160, 200, 'sine', 0.05)
      this.delay(120, () => playTone(120, 240, 'sine', 0.04))
      img.setAngularVelocity(0.12)
    })
  }

  private buildProps(): void {
    for (const prop of this.spec.props) {
      if (prop.kind === 'trampoline') this.addTrampoline(prop)
      else if (prop.kind === 'ball') this.addBall(prop)
      else this.addSeesaw(prop)
    }
  }

  private addTrampoline(prop: PropSpec): void {
    const wPx = this.sz(prop.w ?? 0.12)
    const key = this.trampolineTexture(wPx)
    const frame = this.textures.getFrame(key)
    const img = this.matter.add
      .image(this.toX(prop.x), this.toY(prop.y) - frame.height * 0.35, key, undefined, {
        isStatic: true,
        label: 'trampoline',
        restitution: TRAMPOLINE.restitution,
        friction: TRAMPOLINE.friction,
      })
      .setDepth(13)
    // Bouncy cap: a slimmer sensor-free rectangle across the mushroom top.
    img.setRectangle(wPx * 0.9, frame.height * 0.4, {
      label: 'trampoline',
      isStatic: true,
      restitution: TRAMPOLINE.restitution,
    })
    img.setStatic(true).setAlpha(0)
    this.trampolines.push(img)
    this.trampolineById.set(this.bodyOf(img).id, img)
    img.setData('kind', 'trampoline').setData('ref', prop)
  }

  private addBall(prop: PropSpec): void {
    const rPx = this.sz(prop.r ?? BALL.radius)
    const key = this.ballTexture(rPx)
    const img = this.matter.add.image(this.toX(prop.x), this.toY(prop.y), key, undefined, {
      label: 'ball',
    })
    img.setCircle(rPx * 0.95, { label: 'ball' })
    img.setDensity(BALL.density).setFriction(BALL.friction).setBounce(BALL.restitution)
    img.setStatic(true).setAlpha(0).setDepth(15)
    this.balls.push(img)
    img.setData('kind', 'ball').setData('ref', prop)
  }

  private addSeesaw(prop: PropSpec): void {
    const wPx = this.sz(prop.w ?? 0.22)
    const hPx = this.sz(prop.h ?? 0.026)
    const key = this.plankTexture(wPx, hPx)
    const pivotX = this.toX(prop.x)
    const pivotY = this.toY(prop.y)
    const img = this.matter.add.image(pivotX, pivotY, key, undefined, {
      label: 'plank',
      density: 0.4,
      friction: 0.6,
      frictionAir: 0.02,
    })
    img.setStatic(true).setAlpha(0).setDepth(13)
    this.seesawPlanks.push(img)
    img.setData('kind', 'seesaw').setData('ref', prop)
    // Revolute pivot: pin the plank center to a fixed world point (free to rotate).
    const constraint = this.matter.add.worldConstraint(img.body as unknown as StaticBody, 0, 1, {
      pointA: { x: pivotX, y: pivotY },
    })
    this.constraints.push(constraint)
  }

  private staggerEntrance(): void {
    const movers: Phaser.Physics.Matter.Image[] = [
      ...this.blocks.map((b) => b.img),
      ...this.piggies.map((p) => p.img),
      ...this.balls,
      ...this.seesawPlanks,
    ]
    movers.forEach((img, i) => {
      this.delay(80 + i * 55, () => {
        this.tweens.add({ targets: img, alpha: 1, duration: 200, ease: 'Quad.easeOut' })
      })
    })
    for (const p of this.piggies) {
      this.delay(120, () => this.tweens.add({ targets: p.zzz, alpha: 0.9, duration: 300 }))
    }
    for (const t of this.trampolines) {
      this.tweens.add({ targets: t, alpha: 1, duration: 300 })
    }
    // Wake the physics once everything has settled in visually. The wake drop
    // (bodies fall their spawn gap) collides at ≈0.12 field-units/s, so the
    // grace window keeps those contacts silent and free-proof.
    this.delay(120 + movers.length * 55 + 220, () => {
      for (const img of movers) {
        img.setStatic(false)
        // Big levels stay static past Matter's 60-step sleep countdown (which
        // ticks for static bodies too); a slept mover would ignore gravity and
        // hang mid-air after setStatic(false) — wake it explicitly.
        img.setAwake()
      }
      this.settleGraceUntil = this.time.now + SETTLE_GRACE_MS
      this.canAim = true
      this.lastInteraction = this.time.now
    })
  }

  // ─── Bird lifecycle ────────────────────────────────────────────────────────

  /**
   * The bird queue to fly. Normal play ignores the authored `spec.birds` and
   * serves the player's active bird (read fresh, so a mid-game promotion takes
   * effect on the next reload); the editor honours the authored queue so a
   * hand-tuned level can test a specific bird.
   */
  private birdQueue(): BirdKind[] {
    return this.editorOn ? this.spec.birds : [getActiveBird()]
  }

  private loadBird(kind: BirdKind): void {
    const bird = BIRDS[kind]
    const rPx = this.sz(BIRD_RADIUS) * bird.radiusScale
    const key = this.birdTexture(kind, rPx)
    // Invisible physics body — never scaled, so squash/stretch can't deform it.
    const body = this.matter.add.image(this.forkX, this.forkY, key, undefined, { label: 'bird' })
    body.setCircle(rPx * 0.88, { label: 'bird' })
    body
      .setDensity(bird.density)
      .setFriction(bird.friction)
      .setBounce(bird.restitution)
      .setFrictionAir(0.0015)
    // The hero bird is exempt from sleeping (threshold 0): it waits loaded on
    // the sling far longer than the 60-step sleep countdown, and a slept body
    // cannot be launched (belt on top of the explicit wake in release()).
    body.setSleepThreshold(0)
    body.setStatic(true).setVisible(false)
    // Visible skin follows the body and carries all the squash/stretch.
    const skin = this.add.image(this.forkX, this.forkY, key).setDepth(26)
    this.bird = { body, skin, kind, state: 'loaded' }
    // Little arrival hop (visual only).
    this.tweens.add({
      targets: skin,
      scaleY: { from: 0.8, to: 1 },
      scaleX: { from: 1.2, to: 1 },
      duration: 260,
      ease: 'Back.easeOut',
    })
    this.relaxBand()
  }

  private syncBird(): void {
    // Glue the skin to the body while it flies (and while it rests, spent,
    // before the poof). NOT while loaded: a loaded bird's skin is driven
    // directly (aim pocket, arrival/boing/idle-hop tweens) and syncBird runs
    // *after* the tween manager each frame — syncing here would stomp those
    // tweens (the idle hop would never render). `active` goes false once the
    // body is destroyed during the poof; after that the poof tween owns it.
    if (!this.bird || this.bird.state === 'loaded' || !this.bird.body.active) return
    this.bird.skin.setPosition(this.bird.body.x, this.bird.body.y)
    this.bird.skin.rotation = this.bird.body.rotation
  }

  private reloadNext(): void {
    if (this.levelClearing) return
    this.queueIndex++
    const queue = this.birdQueue()
    this.loadBird(queue[this.queueIndex % queue.length])
    this.lastInteraction = this.time.now
  }

  private landBird(): void {
    if (!this.bird || this.bird.state !== 'flying') return
    this.bird.state = 'spent'
    if (!this.freedThisFlight && !this.levelClearing) {
      this.consecutiveMisses++
      playTone(150, 200, 'sine', 0.05) // soft "whomp" — never harsh
    }
    const { body, skin } = this.bird
    this.delay(POOF_MS, () => {
      this.hearts.explode(6, skin.x, skin.y)
      playTone(660, 90, 'sine', 0.05)
      body.destroy() // removes the physics body from the world
      this.tweens.add({
        targets: skin,
        scaleX: 0,
        scaleY: 0,
        duration: 220,
        ease: 'Back.easeIn',
        onComplete: () => {
          skin.destroy()
          this.reloadNext()
        },
      })
    })
  }

  private flap(): void {
    if (!this.bird || this.bird.state !== 'flying') return
    const v = this.bodyOf(this.bird.body).velocity
    const flapStep = (FLAP_NORM * this.L) / 60
    this.bird.body.setVelocity(v.x, v.y - flapStep)
    playTone(880, 90, 'triangle', 0.07)
    this.sparkles.explode(4, this.bird.skin.x, this.bird.skin.y + this.sz(0.02))
    this.tweens.add({
      targets: this.bird.skin,
      scaleY: { from: 1.2, to: 1 },
      scaleX: { from: 0.85, to: 1 },
      duration: 220,
      ease: 'Quad.easeOut',
    })
  }

  // ─── Aiming input ──────────────────────────────────────────────────────────

  private wireInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.lastInteraction = this.time.now
      if (this.isEditing()) {
        // Tap on empty space deselects (taps on objects select via gameobjectdown).
        if (this.input.hitTestPointer(pointer).length === 0) this.selectObject(null)
        return
      }
      if (this.aiming || this.levelClearing) return
      if (this.bird?.state === 'flying') {
        this.flap()
        return
      }
      if (this.bird?.state === 'loaded' && this.canAim && pointer.x < this.scale.width * 0.55) {
        this.aiming = true
        this.dragStart = { x: pointer.x, y: pointer.y }
        this.updateAim(pointer)
      }
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.aiming) this.updateAim(pointer)
    })
    this.input.on('pointerup', () => {
      if (this.aiming) this.release()
    })
  }

  private updateAim(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.dragStart.x
    const dy = pointer.y - this.dragStart.y
    const len = Math.hypot(dx, dy)
    const maxPull = MAX_PULL_NORM * this.L
    const clamped = Math.min(len, maxPull)
    this.lastPullPx = clamped
    const dirX = len > 0 ? dx / len : 0
    const dirY = len > 0 ? dy / len : 0
    const pocketX = this.forkX + dirX * clamped
    const pocketY = this.forkY + dirY * clamped
    this.bird.body.setPosition(pocketX, pocketY)
    this.bird.skin.setPosition(pocketX, pocketY)

    const power = maxPull > 0 ? clamped / maxPull : 0
    this.bird.skin.scaleX = 1 + power * 0.25
    this.bird.skin.scaleY = 1 - power * 0.2

    const speed = power * MAX_LAUNCH_SPEED_NORM * this.L
    this.launchV = { x: -dirX * speed, y: -dirY * speed }

    this.drawBand(pocketX, pocketY)
    this.drawTrajectory(pocketX, pocketY, this.launchV)

    // Creak rises with stretch.
    const now = this.time.now
    if (now - this.lastCreak > 90 && power > 0.05) {
      playTone(90 + power * 220, 60, 'square', 0.04)
      this.lastCreak = now
    }
  }

  private release(): void {
    this.aiming = false
    this.hideTrajectory()
    if (this.lastPullPx < MIN_PULL_NORM * this.L) {
      // Sub-threshold: hop the bird back with a boing — no dud flight.
      this.bird.body.setPosition(this.forkX, this.forkY)
      this.bird.skin.setPosition(this.forkX, this.forkY)
      this.bird.skin.scaleX = 1
      this.bird.skin.scaleY = 1
      this.tweens.add({
        targets: this.bird.skin,
        scaleX: { from: 0.7, to: 1 },
        scaleY: { from: 1.3, to: 1 },
        duration: 320,
        ease: 'Elastic.easeOut',
      })
      playTone(300, 120, 'sine', 0.05)
      this.relaxBand()
      return
    }
    // Launch. The first launch of a level arms piggy freeing and ends the
    // settle grace immediately, so even an instant fast shot can free.
    this.freeingArmed = true
    this.settleGraceUntil = 0
    this.bird.state = 'flying'
    this.bird.skin.scaleX = 1
    this.bird.skin.scaleY = 1
    this.bird.body.setStatic(false)
    // Matter's Sleeping.update also counts down STATIC motionless bodies, and
    // neither setStatic(false) nor setVelocity wakes a slept one — a sleeping
    // body is skipped by gravity and integration, so without this wake a bird
    // aimed for >1s would "launch" frozen in mid-air.
    this.bird.body.setAwake()
    this.bird.body.setVelocity(this.launchV.x / 60, this.launchV.y / 60)
    this.flightTime = 0
    this.settleTime = 0
    this.freedThisFlight = false
    this.bandGfx.clear()
    // Whoosh: descending sweep + chirp. Bigger, heavier birds launch deeper —
    // pitch is the inverse of the size scale (1.0→1.0, 1.8→~0.55).
    const p = 1 / BIRDS[this.bird.kind].radiusScale
    playTone(680 * p, 60, 'sine', 0.06)
    this.delay(45, () => playTone(480 * p, 60, 'sine', 0.05))
    this.delay(90, () => playTone(320 * p, 70, 'sine', 0.05))
    this.delay(120, () => playTone(900 * p, 60, 'triangle', 0.05))
    // Stretch on launch (visual only).
    this.tweens.add({
      targets: this.bird.skin,
      scaleX: { from: 1.35, to: 1 },
      scaleY: { from: 0.7, to: 1 },
      duration: 260,
      ease: 'Quad.easeOut',
    })
  }

  private drawBand(pocketX: number, pocketY: number): void {
    this.bandGfx.clear()
    this.bandGfx.lineStyle(this.sz(0.012), INK, 1)
    const tip = this.sz(0.035)
    for (const sx of [-tip, tip]) {
      this.bandGfx.beginPath()
      this.bandGfx.moveTo(this.forkX + sx, this.forkY - this.sz(0.02))
      this.bandGfx.lineTo(pocketX, pocketY)
      this.bandGfx.strokePath()
    }
  }

  private relaxBand(): void {
    this.drawBand(this.forkX, this.forkY)
  }

  private drawTrajectory(x0: number, y0: number, v: { x: number; y: number }): void {
    const g = BASE_GRAVITY_NORM * this.spec.gravityScale * this.L
    for (let i = 0; i < TRAJECTORY_DOTS; i++) {
      const t = (i + 1) * TRAJECTORY_DT
      const px = x0 + v.x * t
      const py = y0 + v.y * t + 0.5 * g * t * t
      const dot = this.trajDots[i]
      dot.setPosition(px, py).setVisible(true)
      dot.setAlpha(1 - i / TRAJECTORY_DOTS)
      dot.setScale(1 - (i / TRAJECTORY_DOTS) * 0.5)
    }
  }

  private hideTrajectory(): void {
    for (const dot of this.trajDots) dot.setVisible(false)
  }

  // ─── Collisions ────────────────────────────────────────────────────────────

  private onCollisionStart = (event: {
    pairs: { bodyA: MatterBodyLike; bodyB: MatterBodyLike }[]
  }): void => {
    for (const pair of event.pairs) this.handlePair(pair.bodyA, pair.bodyB)
  }

  private handlePair(a: MatterBodyLike, b: MatterBodyLike): void {
    // Trampoline bounce.
    const tramp = a.label === 'trampoline' ? a : b.label === 'trampoline' ? b : null
    const other0 = tramp === a ? b : a
    if (tramp && other0.label === 'bird') this.boing(tramp)

    // Build/entrance/settle grace: while the level drops into place nothing
    // may free a piggy or thud — second belt behind the launch arming.
    if (this.time.now < this.settleGraceUntil) return

    // Piggy freeing — armed by the first launch of the level; then generous:
    // bird contact frees at any speed; a moving block (fall) or a shoved piggy
    // frees above the L-scaled threshold.
    const piggyBody = a.label === 'piggy' ? a : b.label === 'piggy' ? b : null
    if (piggyBody) {
      const hitter = piggyBody === a ? b : a
      if (
        canFreePiggy(
          this.freeingArmed,
          hitter.label,
          hitter.speed,
          piggyBody.speed,
          this.freeSpeedPx,
        )
      ) {
        const piggy = this.piggyById.get(piggyBody.id)
        if (piggy) this.freePiggy(piggy)
      }
    }

    // Knock / thud sounds, throttled.
    const now = this.time.now
    if (now - this.lastKnock > 55) {
      const impact = Math.max(a.speed, b.speed)
      if (impact > this.knockSpeedPx) {
        const blockBody = a.label === 'block' ? a : b.label === 'block' ? b : null
        if (blockBody) {
          this.knock(this.blockById.get(blockBody.id)?.material ?? 'wood')
          this.dustAt(blockBody.position.x, blockBody.position.y)
          this.lastKnock = now
        } else if (a.label === 'ground' || b.label === 'ground') {
          playTone(150, 70, 'sine', 0.04)
          this.lastKnock = now
        }
      }
    }
  }

  private knock(material: BlockMaterial): void {
    if (material === 'stone') playTone(95, 110, 'square', 0.06)
    else if (material === 'ice') playTone(1200, 70, 'sine', 0.05)
    else playTone(180, 90, 'square', 0.05)
  }

  private boing(trampBody: MatterBodyLike): void {
    playTone(200, 70, 'sine', 0.06)
    this.delay(70, () => playTone(600, 90, 'sine', 0.06))
    const img = this.trampolineById.get(trampBody.id)
    if (img) {
      this.tweens.add({
        targets: img,
        scaleY: { from: 0.6, to: 1 },
        duration: 260,
        ease: 'Back.easeOut',
      })
    }
  }

  private dustAt(x: number, y: number): void {
    this.dustBurst.explode(4, x, y)
  }

  /** Marks any tap as recent interaction (defers the idle nudge). */
  private bump(): void {
    this.lastInteraction = this.time.now
  }

  // ─── Piggy freeing / celebration ───────────────────────────────────────────

  private freePiggy(piggy: Piggy): void {
    if (piggy.freed) return
    piggy.freed = true
    this.freedThisFlight = true
    this.consecutiveMisses = 0
    this.piggyById.delete(this.bodyOf(piggy.img).id)
    this.matter.world.remove(this.bodyOf(piggy.img) as unknown as StaticBody)

    piggy.img.setTexture(this.piggyTexture(true, piggy.rPx))
    piggy.zzz.destroy()

    // Giggle: rising 3-note major arpeggio + pop.
    ;[523, 659, 784].forEach((f, i) => this.delay(i * 90, () => playTone(f, 140, 'triangle', 0.08)))
    this.delay(280, () => playTone(1047, 120, 'square', 0.05))
    this.confetti.explode(16, piggy.img.x, piggy.img.y)

    // Float away on a balloon with a happy spin.
    const balloon = this.add
      .image(piggy.img.x, piggy.img.y - piggy.rPx * 2.4, 'sl-balloon')
      .setDepth(30)
    this.freedBalloons.push(balloon)
    const driftX = piggy.img.x + this.sz((Math.random() - 0.5) * 0.1)
    this.tweens.add({
      targets: [piggy.img, balloon],
      y: `-=${this.sz(1.4)}`,
      x: driftX,
      duration: 2200,
      ease: 'Sine.easeIn',
      onComplete: () => {
        piggy.img.destroy()
        balloon.destroy()
        this.freedBalloons = this.freedBalloons.filter((b) => b !== balloon)
      },
    })
    this.tweens.add({ targets: piggy.img, angle: 360, duration: 2200, ease: 'Sine.easeInOut' })

    if (this.piggies.every((p) => p.freed)) this.delay(320, () => this.celebrate())
  }

  private celebrate(): void {
    if (this.levelClearing) return
    this.levelClearing = true
    this.canAim = false
    this.aiming = false
    // Arm the star-drop hand-off now (before the 2.5s rainbow) so a resize
    // mid-celebration replays this level instead of skipping past the reward.
    this.starDropPending = shouldShowStarDrop(this.level, this.editorOn)

    const w = this.scale.width
    const h = this.scale.height
    const progress = { t: 0 }
    this.rainbowGfx.setAlpha(1)
    this.tweens.add({
      targets: progress,
      t: 1,
      duration: 1300,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.drawRainbow(progress.t),
    })
    this.confetti.explode(24, w * 0.3, h * 0.3)
    this.confetti.explode(24, w * 0.7, h * 0.3)
    this.delay(400, () => this.confetti.explode(20, w * 0.5, h * 0.22))
    ;[523, 659, 784, 988, 1319].forEach((f, i) =>
      this.delay(200 + i * 110, () => playTone(f, 170, 'triangle', 0.09)),
    )

    // Auto-advance to the next level (accepts input again on the new build).
    // The editor instead returns to edit mode on the same draft — a play-test
    // win must never regenerate the level being tuned.
    this.delay(2500, () => {
      this.rainbowGfx.clear()
      if (this.editorOn) {
        this.editorMode = 'edit'
        this.buildLevel(this.level)
        emitEditorChange()
        return
      }
      // Every 3rd level: hand off to the star-drop reward instead of advancing.
      // It persists the reward bird and advances when the child taps it open.
      if (this.starDropPending) {
        this.showStarDrop()
        return
      }
      this.buildLevel(this.level + 1)
    })
  }

  /**
   * Launch the victory-star overlay. The reward is pre-rolled (or forced by the
   * e2e hook), the overlay animates the open as pure theater, and on completion
   * it promotes the active bird and advances to the next level — which then
   * flies the new bird (birdQueue reads getActiveBird fresh on buildLevel).
   */
  private showStarDrop(): void {
    this.starDropPending = false
    const target = this.forcedStarDrop ?? rollStarDropTarget(Math.random)
    this.forcedStarDrop = null
    const rewardLevel = this.level
    this.starDrop = new StarDropOverlay(this, {
      target,
      birdColor: BIRDS[target].color,
      makeBirdImage: (rPx) => this.add.image(0, 0, this.birdTexture(target, rPx)),
      onComplete: (reward) => {
        setActiveBird(reward)
        this.starDrop?.destroy()
        this.starDrop = undefined
        // levelClearing is still set from celebrate(); buildLevel clears it.
        this.buildLevel(rewardLevel + 1)
      },
    })
    this.starDrop.start()
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

  // ─── Update loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    const dt = delta / 1000

    // Snooze bubbles follow their piggies; block faces react to tumbling.
    for (const piggy of this.piggies) {
      if (piggy.freed) continue
      piggy.zzz.x = piggy.img.x
    }
    for (const block of this.blocks) {
      const body = this.bodyOf(block.img)
      // Angular test is in rad/step (resolution-independent); the linear test
      // is L-scaled like every other speed threshold (0.02 field-units/s).
      const tumbling = Math.abs(body.angularVelocity) > 0.04 || body.speed > (0.02 * this.L) / 60
      if (tumbling !== block.oh) {
        block.oh = tumbling
        block.img.setTexture(this.blockTextureKey(block.material, block.wPx, block.hPx, tumbling))
      }
    }

    // Keep the bird skin glued to its physics body.
    this.syncBird()

    // `.active` belt: a flying bird whose body was destroyed by a rebuild must
    // never be integrated (reading a dead body's speed throws and halts RAF).
    if (this.bird && this.bird.state === 'flying' && this.bird.body.active) {
      this.flightTime += dt
      this.applyAssist()
      const body = this.bodyOf(this.bird.body)
      if (body.speed < this.settleSpeedPx) this.settleTime += dt
      else this.settleTime = 0
      if (
        this.settleTime > SETTLE_S ||
        this.flightTime > MAX_FLIGHT_S ||
        this.bird.body.y > this.scale.height + this.sz(0.2)
      ) {
        this.landBird()
      }
    }

    // Idle attract: chirp + hop the loaded bird after 10s of no interaction.
    if (
      this.bird &&
      this.bird.state === 'loaded' &&
      this.canAim &&
      !this.aiming &&
      !this.levelClearing &&
      this.time.now - this.lastInteraction > IDLE_MS
    ) {
      this.lastInteraction = this.time.now
      playTone(700, 90, 'triangle', 0.05)
      this.tweens.add({
        targets: this.bird.skin,
        y: { from: this.forkY - this.sz(0.03), to: this.forkY },
        duration: 320,
        yoyo: true,
        ease: 'Quad.easeOut',
      })
      this.tweens.add({
        targets: this.bandGfx,
        alpha: { from: 1, to: 0.4 },
        duration: 160,
        yoyo: true,
        repeat: 1,
      })
    }
  }

  private applyAssist(): void {
    const strength = assistStrength(this.consecutiveMisses)
    if (strength <= 0) return
    const bx = this.bird.body.x
    const by = this.bird.body.y
    let target: Piggy | null = null
    let best = Infinity
    for (const p of this.piggies) {
      if (p.freed) continue
      const d = Phaser.Math.Distance.Between(bx, by, p.img.x, p.img.y)
      if (d < best) {
        best = d
        target = p
      }
    }
    if (!target) return
    const body = this.bodyOf(this.bird.body)
    const dirX = target.img.x - bx
    const dirY = target.img.y - by
    const mag = Math.hypot(dirX, dirY) || 1
    // Force for a target acceleration a: F = mass * a / 1e6 (Matter @60fps, px units).
    const accel = strength * ASSIST_ACCEL_NORM * this.L
    const f = (body.mass * accel) / 1e6
    this.bird.body.applyForce(new Phaser.Math.Vector2((dirX / mag) * f, (dirY / mag) * f))
  }

  private bodyOf(img: Phaser.Physics.Matter.Image): MatterBodyLike {
    return img.body as unknown as MatterBodyLike
  }

  // ─── Level editor (hidden adult tool) ──────────────────────────────────────
  //
  // Everything below only runs when the URL asked for `?edit`. The scene owns
  // the draft and all mutation; the React EditorPanel is dumb buttons wired
  // through editor/bridge.ts. Draft persistence: localStorage, so an accidental
  // reload never loses a half-tuned level.

  private isEditing(): boolean {
    return this.editorOn && this.editorMode === 'edit'
  }

  private fromX(px: number): number {
    return (px - this.offX) / this.L
  }

  private fromY(py: number): number {
    return (py - this.offY) / this.L
  }

  /** All draggable editor objects of the current build. */
  private editorImages(): Phaser.Physics.Matter.Image[] {
    return [
      ...this.blocks.map((b) => b.img),
      ...this.piggies.map((p) => p.img),
      ...this.balls,
      ...this.trampolines,
      ...this.seesawPlanks,
    ]
  }

  /** Edit-mode build tail: skip entrance, keep static, make draggable. */
  private enterEditLayout(): void {
    for (const img of this.editorImages()) {
      img.setAlpha(1)
      img.setStatic(true)
      if (!img.input) img.setInteractive()
      this.input.setDraggable(img, true)
    }
    for (const p of this.piggies) {
      this.tweens.killTweensOf(p.zzz)
      p.zzz.setAlpha(0.9)
      p.zzz.setPosition(p.img.x, p.img.y - p.rPx * 1.75)
    }
    emitEditorChange()
  }

  private wireEditorInput(): void {
    // A real drag needs a little travel; plain taps stay selection-only.
    this.input.dragDistanceThreshold = 10
    this.input.on(
      'gameobjectdown',
      (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (this.isEditing() && obj.getData('kind')) {
          this.selectObject(obj as Phaser.Physics.Matter.Image)
        }
      },
    )
    this.input.on(
      'drag',
      (
        _p: Phaser.Input.Pointer,
        obj: Phaser.GameObjects.GameObject,
        dragX: number,
        dragY: number,
      ) => {
        if (!this.isEditing() || !obj.getData('kind')) return
        const img = obj as Phaser.Physics.Matter.Image
        img.setPosition(dragX, dragY)
        const piggy = this.piggies.find((p) => p.img === img)
        piggy?.zzz.setPosition(img.x, img.y - piggy.rPx * 1.75)
      },
    )
    this.input.on('dragend', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      if (!this.isEditing() || !obj.getData('kind')) return
      this.writeBack(obj as Phaser.Physics.Matter.Image)
    })
  }

  private selectObject(img: Phaser.Physics.Matter.Image | null): void {
    if (this.selected?.img.active) this.selected.img.clearTint()
    this.selected = null
    if (img) {
      const kind = img.getData('kind') as SelectionKind
      const ref = img.getData('ref') as BlockSpec | PiggySpec | PropSpec
      this.selected = { kind, ref, img }
      img.setTint(0xfff08a)
    }
    emitEditorChange()
  }

  /** Drop: normalized coords back into the draft spec (clamped above ground). */
  private writeBack(img: Phaser.Physics.Matter.Image): void {
    if (!this.draft) return
    const kind = img.getData('kind') as SelectionKind
    const ref = img.getData('ref') as BlockSpec & PiggySpec & PropSpec
    const nx = round3(clamp(this.fromX(img.x), 0.03, 0.97))
    if (kind === 'block') {
      ref.x = nx
      ref.y = round3(clamp(this.fromY(img.y), 0.03, GROUND_Y - ref.h / 2))
    } else if (kind === 'piggy') {
      ref.x = nx
      ref.y = round3(clamp(this.fromY(img.y), 0.03, GROUND_Y - PIGGY.radius))
    } else if (kind === 'ball') {
      ref.x = nx
      ref.y = round3(clamp(this.fromY(img.y), 0.03, GROUND_Y - (ref.r ?? BALL.radius)))
    } else if (kind === 'trampoline') {
      // The image floats above its spec anchor (cap offset); invert that.
      ref.x = nx
      ref.y = round3(clamp(this.fromY(img.y + img.displayHeight * 0.35), 0.2, GROUND_Y))
    } else {
      ref.x = nx
      ref.y = round3(clamp(this.fromY(img.y), 0.1, GROUND_Y - 0.02))
    }
    // Snap the visual to the (possibly clamped) spec position.
    if (kind === 'trampoline') {
      img.setPosition(this.toX(ref.x), this.toY(ref.y) - img.displayHeight * 0.35)
    } else {
      img.setPosition(this.toX(ref.x), this.toY(ref.y))
    }
    const piggy = this.piggies.find((p) => p.img === img)
    piggy?.zzz.setPosition(img.x, img.y - piggy.rPx * 1.75)
    this.saveDraft()
    emitEditorChange()
  }

  private editorAdd(kind: AddKind): void {
    if (!this.draft) return
    const d = this.draft
    // Stagger spawn spots so repeated adds don't stack invisibly.
    const n = d.blocks.length + d.piggies.length + d.props.length
    const x = round3(0.58 + (n % 7) * 0.05)
    if (kind === 'wood' || kind === 'stone' || kind === 'ice') {
      d.blocks.push({
        material: kind,
        x,
        y: round3(GROUND_Y - WOOD_H / 2),
        w: WOOD_W,
        h: WOOD_H,
        angle: 0,
      })
    } else if (kind === 'piggy') {
      d.piggies.push({ x, y: round3(GROUND_Y - PIGGY.radius) })
    } else if (kind === 'ball') {
      d.props.push({ kind: 'ball', x, y: round3(GROUND_Y - BALL.radius), r: BALL.radius })
    } else if (kind === 'trampoline') {
      d.props.push({ kind: 'trampoline', x: 0.44, y: GROUND_Y, w: 0.12 })
    } else {
      d.props.push({ kind: 'seesaw', x, y: round3(GROUND_Y - 0.05), w: 0.22, h: 0.026 })
    }
    this.saveDraft()
    this.buildLevel(this.level)
  }

  private editorDelete(): void {
    if (!this.draft || !this.selected) return
    const { kind, ref } = this.selected
    if (kind === 'block') {
      this.draft.blocks = this.draft.blocks.filter((b) => b !== ref)
    } else if (kind === 'piggy') {
      this.draft.piggies = this.draft.piggies.filter((p) => p !== ref)
    } else {
      this.draft.props = this.draft.props.filter((p) => p !== ref)
    }
    this.selected = null
    this.saveDraft()
    this.buildLevel(this.level)
  }

  private editorRotate(degrees: number): void {
    if (!this.selected || this.selected.kind !== 'block') return
    const ref = this.selected.ref as BlockSpec
    ref.angle = round3(ref.angle + Phaser.Math.DegToRad(degrees))
    this.selected.img.setAngle(Phaser.Math.RadToDeg(ref.angle))
    this.saveDraft()
    emitEditorChange()
  }

  private installEditorApi(): void {
    const api: EditorApi = {
      snapshot: () => ({
        mode: this.editorMode,
        level: this.draft?.level ?? this.level,
        reachable: this.draft ? hasReachablePiggy(this.draft) : false,
        blocks: this.draft?.blocks.length ?? 0,
        piggies: this.draft?.piggies.length ?? 0,
        props: this.draft?.props.length ?? 0,
        selection: this.selected?.kind ?? null,
      }),
      exportJson: () => JSON.stringify(this.draft, null, 2),
      importJson: (json) => {
        const res = parseLevelSpec(json)
        if (!res.ok) return res.error
        this.draft = res.spec
        this.editorMode = 'edit'
        this.saveDraft()
        this.buildLevel(res.spec.level)
        return null
      },
      regenerate: (level) => {
        const lv = Math.max(1, Math.floor(level))
        this.draft = generateLevel(lv, mulberry32(lv))
        this.editorMode = 'edit'
        this.saveDraft()
        this.buildLevel(lv)
      },
      setMode: (mode) => {
        if (mode === this.editorMode) return
        this.editorMode = mode
        this.buildLevel(this.level)
        emitEditorChange()
      },
      add: (kind) => this.editorAdd(kind),
      deleteSelected: () => this.editorDelete(),
      rotateSelected: (degrees) => this.editorRotate(degrees),
    }
    this.editorApi = api
    registerEditorApi(api)
    // e2e drives the editor through the same window hook style as __slingshot.
    if (import.meta.env.DEV || location.search.includes('e2e')) window.__slingshotEditor = api
  }

  private teardownEditorApi(): void {
    if (!this.editorApi) return
    // Same identity guard as the test API: never unregister a remounted scene's.
    if (getEditorApi() === this.editorApi) registerEditorApi(null)
    if (window.__slingshotEditor === this.editorApi) delete window.__slingshotEditor
    this.editorApi = null
  }

  private saveDraft(): void {
    if (!this.draft) return
    try {
      localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(this.draft))
    } catch {
      // Private mode / quota: the draft just isn't persisted.
    }
  }

  private restoreEditorDraft(): LevelSpec | null {
    try {
      const raw = localStorage.getItem(EDITOR_DRAFT_KEY)
      if (!raw) return null
      const res = parseLevelSpec(raw)
      return res.ok ? res.spec : null
    } catch {
      return null
    }
  }
}

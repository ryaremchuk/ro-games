import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { initLevel, reportLevel } from '../../shared/level'
import { addStars, loadProgress, saveData, saveSkill, sessionStart } from '../../shared/progress'
import { onViewportResize, safeAreaInset, viewportSize } from '../../shared/viewport'
import {
  SKILL_MAX,
  SKILL_START,
  generateRound,
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
  episodeFor,
  feedStep,
  friendColor,
  journeyFromData,
  journeyToData,
  scaleForStep,
  shrinkStep,
} from './journey'
import type { Episode, JourneyState } from './journey'
import { artEntries, artKey } from './art'
import type { FeedTestApi } from './testHook'
import * as layout from './layout'
import type { LayoutMetrics, XY } from './layout'
import * as textures from './textures'
import { RequestBubble } from './requestBubble'
import { MonsterRig } from './monsterRig'
import { JourneyStage } from './journeyStage'
import { Tray } from './tray'

/** Registry id — also the key the shared progress store files this under. */
const GAME_ID = 'feed-the-monster'

// ART SPEC palette (episode palettes override the scenery at runtime). The
// shared INK ink moved with its owners: the walker's face + blush to MonsterRig
// (monsterRig.ts), the lineup minis to JourneyStage (journeyStage.ts).
const CONFETTI_TINTS = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff8fab, 0x9b5de5]

// Pentatonic-ish happy tones (C5 D5 E5 G5 A5) + C6 for big moments.
const PENTA = [523, 587, 659, 784, 880]

const FOOD_CSS = 64 // emoji strike stays crisp at ≤80 css px

// Responsive tray/hero/panel geometry now lives in ./layout (pure, unit-tested);
// the scene builds a LayoutMetrics snapshot (see `metrics()`) and delegates.
// Procedural texture generation lives in ./textures (see `buildSceneTextures`).

export default class FeedTheMonsterScene extends Phaser.Scene {
  /** @internal Exposed for RequestBubble's px + reads + MonsterRig's px; not part of the shell API. */
  dpr = 1
  /** @internal Exposed for MonsterRig (body radius drives the whole friend rig). */
  bodyR = 0
  /** @internal Exposed for MonsterRig (current visible growth scale). */
  growth = 1
  /** Cached iOS safe-area inset (CSS px), refreshed on create + every resize. */
  private safeInsetBottom = 0

  private roundNumber = 0
  /** @internal Exposed for RequestBubble (drawPanel/fillPatternSlot/updateBubbleGray). */
  round: Round | null = null
  /** @internal Exposed for RequestBubble (lightPips/fillNotSlot/updateBubbleGray). */
  eaten: string[] = []
  private previousRequest?: FoodRequest
  /** @internal Exposed for RequestBubble (drawPanel/hopBubblePic/punchPatternRing) + MonsterRig (giggle/sneeze guards). */
  transitioning = false
  /** @internal Exposed for MonsterRig (sneeze re-entry guard, read+written by its sneeze/scheduleBlink). */
  sneezing = false
  /** @internal Exposed for MonsterRig (cross-eyed window; written here on a spit-back, read by its update). */
  funnyUntil = 0

  // Adaptive cognitive meter (invisible; drives the task registry).
  private skill = SKILL_START
  private skillPeak = SKILL_START
  private roundStartAt = 0
  private spitBacks = 0
  private recentKinds: TaskKind[] = []

  // The visible long-term journey: growing friends, episodes (journey.ts).
  /** @internal Exposed for MonsterRig (drives which friend to build + the aura step). */
  journey: JourneyState = { episode: 0, friendsFed: 0, growthStep: 0 }
  /** @internal Exposed for RequestBubble (panel border tint + splash tint reads). */
  episode!: Episode

  private bgGfx!: Phaser.GameObjects.Graphics
  private bgImage!: Phaser.GameObjects.Image

  /**
   * The feedable friend (body, growth aura, face, all its animations/reactions
   * + the per-frame pupil tracking). Owns its own display objects; reads live
   * scene state through the passed `this`. See ./monsterRig.
   * @internal Exposed for JourneyStage (build/container/applyAura/lighten).
   */
  readonly monsterRig = new MonsterRig(this)
  /**
   * The long-term journey stage (grown-friends lineup + every between-round
   * celebration sequence). Owns its own display objects (the minis + their
   * idle-glance pupils); reads live scene state through the passed `this`.
   * @internal Exposed for MonsterRig (its scheduleBlink reads stage.miniPupils).
   * See ./journeyStage.
   */
  readonly stage = new JourneyStage(this)

  /**
   * The task-request bubble (top panel + tiles/pips/sockets/bans/ring/✓ + the
   * audio cue). Owns its own display objects; reads live scene state through
   * the passed `this`. See ./requestBubble.
   */
  private readonly bubbleUi = new RequestBubble(this)

  /**
   * The food tray (plates + draggable foods, their build/layout/animation and
   * the drag mechanics). Owns its own display objects; reads live scene state
   * through the passed `this` and hands a food dropped over the mouth back to
   * `feed`. See ./tray.
   * @internal Exposed for MonsterRig (its update tracks `tray.dragged`).
   */
  readonly tray = new Tray(this)

  /** @internal Exposed for JourneyStage (friendGrownSequence + celebrateLineup). */
  confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  /** @internal Exposed for JourneyStage (friendGrownSequence + celebrateLineup). */
  stars!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  /** @internal Exposed for MonsterRig (the sneeze puff burst). */
  puffs!: Phaser.GameObjects.Particles.ParticleEmitter
  /**
   * Continuous growth-aura sparkles orbiting the friend (rate ∝ growth).
   * @internal Exposed for MonsterRig (its tickAura emits from here).
   */
  auraSparkle!: Phaser.GameObjects.Particles.ParticleEmitter

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

  /**
   * Is this art sprite available? Consumers fall back to procedural looks.
   * @internal Exposed for MonsterRig (its build picks art vs procedural looks).
   */
  hasArt(name: string): boolean {
    return this.textures.exists(artKey(name))
  }

  create(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.safeInsetBottom = safeAreaInset('bottom')
    this.bodyR = Math.min(Math.min(this.scale.width, this.scale.height) * 0.17, this.px(150))

    // Resume the saved skill meter a couple of steps down (warm-up ramp);
    // the peak makes below-peak climbs twice as fast (see logic.updateSkill).
    const saved = loadProgress(GAME_ID)
    // Resume the visible level badge from the saved star trophy (every level
    // passed banked one star), so the count climbs across sessions.
    initLevel(GAME_ID)
    this.skillPeak = saved.skill.cognitive ?? SKILL_START
    this.skill = sessionStart(this.skillPeak, { max: SKILL_MAX, lastPlayedAt: saved.lastPlayedAt })

    // Resume the journey exactly where it left off — the long-term
    // progression (friends grown, episodes) survives restarts by design.
    this.journey = journeyFromData(saved.data)
    this.episode = episodeFor(this.journey)
    this.growth = scaleForStep(this.journey.growthStep)

    textures.buildSceneTextures(this, {
      dpr: this.dpr,
      bodyR: this.bodyR,
      episode: this.episode,
      color: this.friendBodyColor(),
      foodCss: FOOD_CSS,
    })

    this.bgGfx = this.add.graphics().setDepth(0)
    // Full-bleed episode backdrop (bg-<episode>.png), cover-scaled in layout();
    // the gradient beneath stays as the fallback and edge filler.
    this.bgImage = this.add.image(0, 0, '__DEFAULT').setDepth(0).setVisible(false)
    this.monsterRig.build()
    this.tray.buildPlates()
    this.bubbleUi.build()
    this.buildEmitters()
    this.wireInput()

    // Restore the fed-friends lineup, no fanfare (build already lit the
    // current friend's aura to its growth step).
    for (let i = 0; i < this.journey.friendsFed; i++) this.stage.spawnMini(i)

    this.layout()
    this.monsterRig.scheduleBlink()
    // Ambient growth sparkles: a steady tick that emits denser the more grown
    // the current friend is (tickAura reads the live growth each time).
    this.time.addEvent({
      delay: 130,
      loop: true,
      callback: this.monsterRig.tickAura,
      callbackScope: this.monsterRig,
    })

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
        foods: this.tray.foods.map((f) => ({
          foodId: f.getData('foodId') as string,
          correct: this.round
            ? wantsFood(this.round.request, this.eaten, f.getData('foodId') as string)
            : false,
          xCss: f.x / this.dpr,
          yCss: f.y / this.dpr,
        })),
        mouth: {
          xCss: this.monsterRig.mouthWorld().x / this.dpr,
          yCss: this.monsterRig.mouthWorld().y / this.dpr,
        },
        bubbleTiles: this.bubbleUi.tileCount,
        journey: { ...this.journey },
        episodeId: this.episode.id,
        growthScale: this.monsterRig.growthScale,
        aura: auraIntensity(this.journey.growthStep),
        miniCount: this.stage.miniCount,
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
    textures.buildSceneTextures(this, {
      dpr: this.dpr,
      bodyR: this.bodyR,
      episode: this.episode,
      color: this.friendBodyColor(),
      foodCss: FOOD_CSS,
    })
    for (const mini of this.stage.minis) {
      this.tweens.killTweensOf(mini)
      mini.destroy()
    }
    this.stage.minis = []
    for (let i = 0; i < this.journey.friendsFed; i++) this.stage.spawnMini(i)
    this.growth = scaleForStep(this.journey.growthStep)
    this.monsterRig.build()
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
    this.tray.buildTray(round.tray)
    this.bubbleUi.showRequest(round.request)
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

  /**
   * The current friend's body hue (episode × lineup position, stable).
   * @internal Exposed for MonsterRig (its build tints the body/halo/nose).
   */
  friendBodyColor(): number {
    return friendColor(this.journey.episode, this.journey.friendsFed)
  }

  // ─── Fed-friends lineup + friend/episode transitions ───────────────────────

  /**
   * Fed friends huddle together as a cozy pile in the bottom-left corner —
   * they overlap and stack (a heap, not a spread-out lineup). Offsets are in
   * bodyR units, anchored to the shared heroBaseline so the pile tracks the
   * hero (and the tray) proportionally on every screen.
   * @internal Exposed for JourneyStage (spawnMini + friendGrownSequence).
   */
  miniSlot(index: number): XY {
    return layout.miniSlot(this.metrics(), index)
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
    // The food-drag mechanics (draggable foods + the drop→feed decision) live
    // on the tray; the scene wires only the non-food background taps.
    this.tray.wireDrag()

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
  /**
   * Live snapshot the pure ./layout geometry reads from.
   * @internal Exposed for Tray (its slot/plate/snap geometry reads from it).
   */
  metrics(): LayoutMetrics {
    return {
      w: this.scale.width,
      h: this.scale.height,
      dpr: this.dpr,
      bodyR: this.bodyR,
      growth: this.growth,
      safeInsetBottom: this.safeInsetBottom,
    }
  }

  private slotPos(index: number): XY {
    return layout.slotPos(this.metrics(), index)
  }

  /** @internal Exposed for MonsterRig (its shakeHead re-anchors to the hero x). */
  monsterPos(): XY {
    return layout.monsterPos(this.metrics())
  }

  /** @internal Exposed for JourneyStage (nextFriendEnters + episodeTransition). */
  layout(): void {
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
    this.monsterRig.container.setPosition(mp.x, mp.y)
    this.bubbleUi.reposition()

    this.stage.minis.forEach((mini, i) => {
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

    for (let i = 0; i < this.tray.plates.length; i++) {
      const slot = this.slotPos(i)
      this.tray.dressPlate(this.tray.plates[i]) // episode may have changed the marker
      this.tray.plates[i].setPosition(slot.x, slot.y + this.px(14))
    }
    for (const food of this.tray.foods) {
      if (food === this.tray.dragged) continue
      this.tweens.killTweensOf(food)
      const slot = this.slotPos(food.getData('slot') as number)
      food.setPosition(slot.x, slot.y)
      food.setScale(this.tray.foodBaseScale(food))
    }
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
    this.tray.buildTray(round.tray)
    this.bubbleUi.showRequest(round.request)
    this.time.delayedCall(450, () => this.bubbleUi.playRequestCue(round.request))
  }

  // ─── Feeding ─────────────────────────────────────────────────────────────

  /**
   * A food dropped over the mouth is eaten: it flies into the mouth, then
   * swallow() decides right/wrong. Kept on the scene (the round state machine).
   * @internal Exposed for Tray (its dragend hands off a valid drop here).
   */
  feed(img: Phaser.GameObjects.Image): void {
    img.disableInteractive()
    this.monsterRig.setMouthOpen(1, 80)
    this.tweens.killTweensOf(img)
    const mouth = this.monsterRig.mouthWorld()
    const base = this.tray.foodBaseScale(img)
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
    this.tray.foods = this.tray.foods.filter((f) => f !== img)
    img.destroy()

    // Chomp: mouth snaps shut + squash & stretch (volume conserved).
    this.monsterRig.setMouthOpen(0, 70)
    this.tweens.add({
      targets: this.monsterRig.container,
      scaleX: this.growth * 1.18,
      scaleY: this.growth * 0.84,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => this.monsterRig.container.setScale(this.growth),
    })

    // Crunch burst, then the ascending count beep (descriptive feedback).
    playTone(196, 70, 'square', 0.08)
    this.time.delayedCall(60, () => playTone(147, 60, 'square', 0.06))
    const step = Math.min(this.eaten.length - 1, PENTA.length - 1)
    this.time.delayedCall(150, () => playTone(PENTA[step], 170, 'sine', 0.12))

    const kind = this.round.request.kind
    if (kind === 'not') this.bubbleUi.fillNotSlot(foodId)
    else if (kind === 'dots') this.bubbleUi.lightPips()
    else this.bubbleUi.updateBubbleGray()

    if (isRoundComplete(this.round.request, this.eaten)) {
      if (kind === 'pattern') this.bubbleUi.fillPatternSlot()
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
    this.monsterRig.setMouthOpen(0.45, 90)
    this.time.delayedCall(260, () => this.monsterRig.setMouthOpen(0, 140))
    this.monsterRig.squintEyes()
    this.monsterRig.shakeHead()

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
          targets: this.monsterRig.container,
          scaleX: { from: this.monsterRig.container.scaleX * 1.06, to: this.growth },
          scaleY: { from: this.monsterRig.container.scaleY * 0.82, to: this.growth },
          duration: 420,
          ease: 'Bounce.easeOut',
          onComplete: () => this.layout(),
        })
        this.monsterRig.applyAura(true)
      })
    }

    const slot = this.slotPos(img.getData('slot') as number)
    const base = this.tray.foodBaseScale(img)
    this.tray.arcTo(img, slot.x, slot.y, 550, () => {
      img.setInteractive()
      if (this.transitioning) this.tray.fadeOutFood(img)
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
    this.tray.foods.forEach((food, i) => {
      if (food === this.tray.dragged || this.tweens.isTweening(food)) return
      this.time.delayedCall(150 + i * 40, () => this.tray.fadeOutFood(food))
    })

    // Burp + confetti.
    const mp = this.monsterPos()
    this.time.delayedCall(250, () => {
      playTone(98, 220, 'sawtooth', 0.09)
      this.time.delayedCall(170, () => playTone(78, 190, 'sawtooth', 0.07))
      this.confetti.explode(60, mp.x, mp.y - this.bodyR * this.growth)
      this.monsterRig.beHappy(900) // laugh with the confetti (guards its own revert on rebuild)
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
        targets: this.monsterRig.container,
        scaleX: this.growth,
        scaleY: this.growth,
        duration: 380,
        ease: 'Back.easeOut',
        onComplete: () => this.layout(),
      })
      this.time.delayedCall(200, () => {
        this.monsterRig.applyAura(true)
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
      targets: this.monsterRig.container,
      scaleX: this.growth,
      scaleY: this.growth,
      duration: 380,
      ease: 'Back.easeOut',
    })
    this.time.delayedCall(250, () => this.monsterRig.applyAura(true, GROW_STEPS))

    // Then: walk to the lineup, the whole lineup dances to welcome the new
    // friend, and the next friend hops in (on the 5th, the grander dance +
    // episode change) — play resumes once that friend is on stage and feedable.
    const resume = () => this.startRound(this.roundNumber + 1)
    this.time.delayedCall(650, () =>
      this.stage.friendGrownSequence(outcome === 'episode-complete', resume),
    )
  }

  // ─── Per-frame: pupils track the food / last touch ───────────────────────

  update(): void {
    // 100% monster pupil tracking — delegated to the rig (the lineup minis
    // deliberately do NOT track; they idle-glance on their own timers).
    this.monsterRig.update()
  }
}

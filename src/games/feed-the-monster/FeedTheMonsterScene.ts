import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { addStars, loadProgress, saveData, saveSkill, sessionStart } from '../../shared/progress'
import { onViewportResize, safeAreaInset, viewportSize } from '../../shared/viewport'
import {
  FOOD_COLORS,
  SKILL_MAX,
  SKILL_START,
  SPIT_BACKS_BEFORE_EASE,
  TASK_REGISTRY,
  activePoolForRound,
  generateRound,
  generateTray,
  isRoundComplete,
  poolWithFood,
  requestTotal,
  shouldInjectDuo,
  updateSkill,
  wantsFood,
  withDrawnFoods,
} from './logic'
import type { DuoContext, Food, FoodColor, FoodRequest, Round, TaskKind } from './logic'
import {
  BIG_BITE,
  COMMISSION_ANNOUNCE_MS,
  COMMISSION_COLOR_MIN_SKILL,
  DRAWN_CALLBACK_ROUNDS,
  FRIENDS_PER_EPISODE,
  GROW_STEPS,
  NORMAL_BITE,
  auraIntensity,
  commissionColor,
  commissionGate,
  episodeFor,
  feedStep,
  friendColor,
  growAmount,
  isStuck,
  journeyFromData,
  journeyToData,
  scaleForStep,
  shrinkStep,
} from './journey'
import type { Episode, JourneyState } from './journey'
import { gridToDrawing } from '../../shared/pixel/artStore'
import type { Drawing } from '../../shared/pixel/artStore'
import { createGrid, paintCell } from '../../shared/pixel/grid'
import { adoptDrawing, loadDrawnFoods, stampDrawnFood, wipeDrawnFoods } from './drawnFoods'
import { artEntries, artKey } from './art'
import type { FeedTestApi } from './testHook'
import * as layout from './layout'
import type { LayoutMetrics, XY } from './layout'
import * as textures from './textures'
import { RequestBubble } from './requestBubble'
import { MonsterRig } from './monsterRig'
import { JourneyStage } from './journeyStage'
import { Tray } from './tray'
import { DuoMode } from './duoMode'
import type { FeedMouth } from './duoMode'
import { ConveyorMode } from './conveyorMode'
import { KitchenMode } from './kitchenMode'
import { ThiefMode } from './thiefMode'
import { THIEF_SKILL_MAX, shouldVisit, updateThiefSkill } from './thief'
import type { VisitOutcome } from './thief'
import {
  BELT_SKILL_MAX,
  CONVEYOR_EXCLUDED_KINDS,
  beltDials,
  shouldInjectConveyor,
  updateBeltSkill,
} from './belt'

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
  /**
   * Wrong feeds accumulated over the CURRENT friend's whole tenure (reset when
   * a fresh friend hops in). Once it crosses journey.BIG_BITE_STUCK_SPITS the
   * round becomes a big bite (+2) — a catch-up so a struggling toddler never
   * gets stuck on the +1/−1 treadmill. It used to fire silently on completion;
   * now it fires the moment the debt is due, and is SHOWN (see setBigBite).
   */
  private friendSpitBacks = 0
  /**
   * Is the round being played right now a BIG BITE (+2 growth)? Rolled at round
   * START — not on completion — so the child is told about it while it still
   * matters: the friend smacks its lips, the tray lights up gold and the food
   * grows (see dressBigBite). A round that turns rough upgrades mid-play.
   */
  private bigBite = false
  /**
   * RNG for the random half of the big bite (the stuck catch-up bypasses it).
   * Defaults to Math.random; e2e pins it via setRandomBigBite so growth
   * assertions stay deterministic. See growAmount / logic's forceKind pattern.
   */
  private growthRng: () => number = Math.random
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
   * @internal Exposed for DuoMode (it stands the solo panel down via setHidden).
   */
  readonly bubbleUi = new RequestBubble(this)

  /**
   * The duo BONUS round controller — two friends fed at once from one tray, on
   * its own data+chance injection axis (never the difficulty meter). Inactive
   * unless a duo is on stage; the solo round flow above is left untouched.
   * See ./duoMode.
   */
  readonly duoMode = new DuoMode(this)
  /** Solo rounds since the last duo (anti-drought ramp); large so the first is
   * eligible once the child is competent. Reset when a duo starts. */
  private roundsSinceLastDuo = 99
  /** Did the last completed round ease the meter (≥2 spit-backs)? Gates duos —
   * we never pile two friends on a struggling child. */
  private lastRoundEased = false
  /** Dev overlay: force the next friend-boundary round to be a duo. */
  private forceDuoNext = false

  // ─── Commissions: the food the child drew ──────────────────────────────────
  /**
   * The foods the child has drawn that are currently in the rotation — at most
   * six, one per colour (see drawnFoods.ts). They SUBSTITUTE into the episode
   * pool rather than extend it, so the "every window has every colour"
   * satisfiability invariant survives (logic.withDrawnFoods).
   */
  private drawnFoods: Food[] = []
  /**
   * The live commission, while the pad is open over the scene. The React shell
   * watches this through the `commission` scene event.
   */
  private commission: { color: FoodColor; askColor: boolean; asked: boolean } | null = null
  /** Episode index of the last commission OFFERED (−1 = never). Persisted. */
  private lastCommissionEpisode = -1
  /** The friend nagging for its drawing while the pad is open; cleared on submit. */
  private impatience?: Phaser.Time.TimerEvent
  /** Dev overlay: open a commission at the next round start whatever the journey. */
  private forceCommissionNext = false
  /**
   * The drawn food the friend will ask for BY NAME once the countdown runs out —
   * the emotional payoff of the whole feature, and mechanically just a nudge on
   * the next count round (logic's RoundContext.preferFoodId).
   */
  private callbackFoodId: string | null = null
  private callbackInRounds = 0
  /** Turns the completion celebration up for the round that eats a new drawing. */
  private drawnBiteRound = false

  /**
   * The CONVEYOR round mode — the plate row replaced, for that round, by a slow
   * kaiten-sushi loop. Injected on its own data+chance axis and driven by its OWN
   * persisted meter (`belt`), so belt practice and task difficulty scale
   * independently: a child can be great at colours and bad at timing.
   * See ./conveyorMode and ./belt.
   */
  readonly conveyorMode = new ConveyorMode(this)
  /**
   * The KITCHEN — the pot a `dish` / `dish-ordered` round is cooked in. Unlike the
   * belt and the duo, cooking is a TASK KIND in the registry, not a separate axis:
   * it is a cognitive task (part–whole composition), so the cognitive meter owns
   * it. See ./kitchenMode and ./recipes.
   */
  readonly kitchenMode = new KitchenMode(this)
  /**
   * The THIEF — the game's first interruption. Rides its own persisted meter
   * (`thief`) on its own data+chance axis, gated so it never lands on a struggling
   * child. See ./thiefMode and ./thief.
   */
  readonly thiefMode = new ThiefMode(this)
  /** The thief axis's own adaptive meter, 0..THIEF_SKILL_MAX (persisted). */
  private thiefSkill = 0
  /** Rounds since the last visit (anti-drought ramp); large so the first is soon. */
  private roundsSinceLastVisit = 99
  /** A visit is scheduled for this round; cancelled on completion/transition. */
  private visitTimer?: Phaser.Time.TimerEvent
  /** Dev overlay: send the bird in at the next round start regardless of the axis. */
  private forceVisitorNext = false
  /** The belt's own adaptive meter, 0..BELT_SKILL_MAX (persisted separately). */
  private beltSkill = 0
  /** Solo rounds since the last belt round (anti-drought ramp). */
  private roundsSinceLastConveyor = 99
  /** Dev overlay: make the next round a belt round. */
  private forceConveyorNext = false

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
    this.skillPeak = saved.skill.cognitive ?? SKILL_START
    this.skill = sessionStart(this.skillPeak, { max: SKILL_MAX, lastPlayedAt: saved.lastPlayedAt })
    // The belt rides its own axis — same warm-up ramp, its own ceiling.
    this.beltSkill = sessionStart(saved.skill.belt ?? 0, {
      max: BELT_SKILL_MAX,
      warmupDrop: 1,
      lastPlayedAt: saved.lastPlayedAt,
    })
    this.thiefSkill = sessionStart(saved.skill.thief ?? 0, {
      max: THIEF_SKILL_MAX,
      warmupDrop: 1,
      lastPlayedAt: saved.lastPlayedAt,
    })

    // Resume the journey exactly where it left off — the long-term
    // progression (friends grown, episodes) survives restarts by design.
    this.journey = journeyFromData(saved.data)
    this.lastCommissionEpisode = Number.isFinite(saved.data.commissionEpisode)
      ? saved.data.commissionEpisode
      : -1
    this.episode = episodeFor(this.journey)
    this.growth = scaleForStep(this.journey.growthStep)

    textures.buildSceneTextures(this, {
      dpr: this.dpr,
      bodyR: this.bodyR,
      episode: this.episode,
      color: this.friendBodyColor(),
      foodCss: FOOD_CSS,
    })

    // The foods the child drew in earlier sessions come back as foods: textures
    // registered, catalog entries registered, ready to be asked for.
    this.drawnFoods = loadDrawnFoods(this, { dpr: this.dpr, foodCss: FOOD_CSS })

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
      callback: this.tickAuras,
      callbackScope: this,
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
        bubbleFoodIds: this.bubbleUi.tileFoodIds,
        bubbleBox: this.bubbleUi.boxCss(),
        journey: { ...this.journey },
        episodeId: this.episode.id,
        growthScale: this.monsterRig.growthScale,
        aura: auraIntensity(this.journey.growthStep),
        miniCount: this.stage.miniCount,
        bigBite: this.bigBite,
        foodBoost: this.tray.foodBoost,
        duoActive: this.duoMode.active,
        duo: this.duoMode.active ? this.duoMode.snapshot() : null,
        commission: this.commission
          ? {
              color: this.commission.color,
              askColor: this.commission.askColor,
              phase: this.commission.asked ? ('drawing' as const) : ('asking' as const),
            }
          : null,
        commissionGate: this.commissionGateNow(),
        drawnFoodIds: this.drawnFoods.map((f) => f.id),
        conveyorActive: this.conveyorMode.active,
        conveyor: this.conveyorMode.active ? this.conveyorMode.snapshotState() : null,
        beltSkill: this.beltSkill,
        kitchen: this.kitchenMode.active ? this.kitchenMode.snapshotState() : null,
        visitor: this.thiefMode.snapshotState(),
        thiefSkill: this.thiefSkill,
      }),
      forceKind: (kind) => {
        if (!this.devTakeStage()) return false
        this.buildFreshRound({ forceKind: kind, previous: this.previousRequest })
        return true
      },
      forceDuo: () => {
        // One duo at a time: a duo already on stage is what the button asks for,
        // and the panel's readout says DUO.
        if (this.duoMode.active) return false
        // Needs a live solo round (never during the pre-first-round delay — the
        // scheduled startRound(1) would clobber the duo) and ≥2 free slots.
        if (!this.devTakeStage()) return false
        if (FRIENDS_PER_EPISODE - this.journey.friendsFed < 2) return false
        this.roundsSinceLastDuo = 0
        // A duo bypasses startRound, so it must put the previous round's modes
        // away itself — a belt left riding under a duo destroys its food.
        this.standDownModes()
        this.duoMode.start()
        return true
      },
      forceJourney: (partial) => {
        if (!this.devTakeStage()) return false
        this.applyJourney(journeyFromData({ ...journeyToData(this.journey), ...partial }))
        return true
      },
      setRandomBigBite: (enabled) => {
        // enabled → real dice; disabled → rng()=1 never clears BIG_BITE_CHANCE,
        // so only the stuck catch-up can big-bite. Keeps e2e growth exact.
        this.growthRng = enabled ? Math.random : () => 1
        // The dice are now rolled at round START, so the live round may already
        // have won one before the spec got to speak. Take it back — unless the
        // catch-up owns it, which this switch deliberately never touches.
        if (!enabled && !isStuck(this.friendSpitBacks)) this.setBigBite(false)
      },

      // Dev cheats behind the `?dev` overlay (see FeedDevPanel): nudge one
      // journey axis / re-deal a round for faster manual testing. Each no-ops
      // mid-transition so a celebration's tween chain is never severed.
      devHeroLevel: (delta) => this.devNudgeJourney({ growthStep: delta }),
      devFriends: (delta) => this.devNudgeJourney({ friendsFed: delta }),
      devEpisode: (delta) => this.devNudgeJourney({ episode: delta }),
      devBigBite: (on) => {
        if (!this.devTakeStage()) return false
        this.setBigBite(on)
        return true
      },
      forceCommission: () => {
        // Already asking: the pad is up, there is nothing to force.
        if (this.commission) return false
        // Needs a LIVE round, like every other mode force: before the first round
        // is dealt there is still a scheduled startRound in flight, and it would
        // land on top of the ask (which the announce guard then abandons, leaving
        // the adult with nothing to look at).
        if (!this.devTakeStage()) return false
        this.forceCommissionNext = true
        // Re-enter the round start so the gate runs now, not next round.
        this.startRound(this.roundNumber)
        return this.commission !== null
      },
      submitDrawing: (cells) => {
        if (!this.commission) return false
        const grid = createGrid(16)
        for (const cell of cells) paintCell(grid, cell.x, cell.y, cell.color)
        this.submitCommission(cells.length > 0 ? gridToDrawing(grid) : null)
        return true
      },
      forceConveyor: () => {
        if (!this.devTakeStage()) return false
        // This path does not go through startRound, so it stands the outgoing
        // belt down itself — serving a second belt over a live one would leak its
        // plates and strip.
        this.conveyorMode.stop()
        this.roundsSinceLastConveyor = 0
        this.setBigBite(false)
        this.dealRound(true)
        return true
      },
      forceVisitor: () => {
        if (this.thiefMode.active) return false
        if (!this.devTakeStage()) return false
        // A visitor never shares a round with the belt (scheduleVisit's `busy`
        // says so), and it aims at a STILL tray slot — which a belt round has
        // stood down. Forcing one here would peck at an invisible plate, so deal
        // a still round first and let the bird land on that.
        if (this.conveyorMode.active) this.buildFreshRound({ previous: this.previousRequest })
        this.visitTimer?.remove()
        this.visitTimer = undefined
        this.roundsSinceLastVisit = 0
        return this.thiefMode.start(this.thiefSkill)
      },
      wipeDrawnFoods: () => {
        wipeDrawnFoods()
        this.drawnFoods = []
        this.callbackFoodId = null
        this.lastCommissionEpisode = -1
        saveData(GAME_ID, { commissionEpisode: -1 })
        return true
      },

      devRegenerate: () => {
        if (!this.devTakeStage()) return false
        // Dev: re-deal a TRULY RANDOM task across EVERY kind, not gated by the
        // current meter — so tapping ↻ cycles through all types an adult wants
        // to eyeball (the child never sees this overlay).
        const kinds = TASK_REGISTRY.map((def) => def.kind)
        const kind = kinds[Math.floor(Math.random() * kinds.length)]
        this.buildFreshRound({ forceKind: kind, previous: this.previousRequest })
        return true
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
    this.friendSpitBacks = 0
    this.setBigBite(false) // a rebuilt world deals a fresh, undressed round
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

  /**
   * Clear the stage so a dev force can land, and say whether it may.
   *
   * The ONLY state it refuses is a celebration in flight: `transitioning` guards a
   * tween/timer chain whose completion is the single path back to a playable round,
   * and severing it soft-locks the game. Everything else it RESOLVES instead of
   * refusing — a duo and a drawing ask both null `round` for as long as they run,
   * and every force needs a live round, so refusing left the whole `?dev` overlay a
   * silent no-op for tens of seconds at a time. That is what "the panel stops
   * responding, no button does anything" was: not a dead panel, a busy game with no
   * way to say so and no way out.
   */
  private devTakeStage(): boolean {
    if (this.transitioning) return false
    if (this.commission) {
      this.withdrawCommission()
      this.dealRound() // the ask dealt no tray; give the friend a round to be in
    }
    if (this.duoMode.active) {
      this.duoMode.abort()
      // Rebuild the solo walker at the live journey point and deal it a round —
      // the same path the `?dev` journey nudges use.
      this.applyJourney(this.journey)
    }
    // Before the very first round is dealt there is still a scheduled
    // startRound(1) in flight, which would clobber whatever we force now.
    return this.round !== null
  }

  /** Nudge one journey axis by delta (clamped to its valid range), rebuild. */
  private devNudgeJourney(delta: Partial<JourneyState>): boolean {
    if (!this.devTakeStage()) return false
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
    return true
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
      foods: this.episodeFoods(),
      forceKind: opts.forceKind,
    })
    this.eaten = []
    this.spitBacks = 0
    // A re-deal is a round boundary too: the previous round's belt/pot/visitor
    // must not outlive the round that invited them (see standDownModes).
    this.standDownModes()
    this.presentRound(round)
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

    // A duo positions its two friends (+ their bubbles); a solo round its one.
    if (this.duoMode.active) {
      this.duoMode.placeFriends()
    } else {
      const mp = this.monsterPos()
      this.monsterRig.container.setPosition(mp.x, mp.y)
    }
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
      this.tray.placeSlot(i, this.slotPos(i)) // re-anchors the glow + reskins the plate
    }
    this.kitchenMode.place()
    // On the belt a food's home is its LANE, not a plate slot — re-anchoring to
    // slotPos here would yank every dish into the (hidden) still row on a resize.
    if (this.conveyorMode.active) {
      this.conveyorMode.place()
      return
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
    this.drawnBiteRound = false
    this.roundsSinceLastDuo++
    this.roundsSinceLastConveyor++
    this.standDownModes()
    // A duo grows on its own synchronized curve (journey.duoFeedStep), so a big
    // bite never applies to one — clear the dressing before handing the round over.
    this.setBigBite(false)
    // A commission is a once-per-episode journey beat and takes precedence over
    // the duo axis (which gets its chance the very next round). Both only ever
    // land on a fresh friend, so they would otherwise compete for the same slot.
    if (this.tryCommission()) return
    // A duo bonus only ever begins at a friend boundary (a fresh friend about to
    // start), on its own data+chance axis — never mid-growth of a solo friend.
    if (this.journey.growthStep === 0 && this.tryInjectDuo()) return

    // The belt is a whole-round mode: decided here, before the round is dealt, so
    // the generator can be told which task kinds it cannot host.
    const conveyor = this.tryInjectConveyor()
    // Roll the big bite BEFORE the tray is built, so a big-bite round's food
    // drops in already boosted and the whole round reads as special from its
    // first frame. (It used to be rolled on completion, where nothing could
    // show it.) The stuck half is re-checked live in spitBack. A belt round is
    // never a big bite: the belt IS the treat, and eight glowing plates behind a
    // moving belt would just be noise.
    if (!conveyor) {
      this.setBigBite(
        growAmount({ friendSpitBacks: this.friendSpitBacks, rng: this.growthRng }) === BIG_BITE,
      )
    }
    this.dealRound(conveyor)
  }

  /**
   * Put the PREVIOUS round's modes away. This is the round boundary's job, and
   * only its job: standing the belt down used to live inside tryInjectConveyor's
   * declined branch, so every gate that returns early — a commission, a duo —
   * skipped it and left the belt riding underneath the new round. Under a duo
   * that is not merely untidy: `tray.homeProvider` still pointed at the belt, so
   * a duo food spat back was adopted onto a lane and then DESTROYED when that
   * lane wrapped past the hatch — a duo missing a food it still needs can never
   * be completed, and a duo that never completes never gives `round` back, which
   * soft-locks the game (and, because every dev force is gated on a live round,
   * makes the whole `?dev` panel inert).
   *
   * A mode this round wants is stood back up immediately (the belt in
   * presentRound, the pot for a `dish` request), so the child sees no gap.
   */
  private standDownModes(): void {
    this.conveyorMode.stop()
    this.kitchenMode.stop()
    // A visitor belongs to the round that invited it; a fresh round schedules
    // its own (see scheduleVisit).
    this.thiefMode.cancel()
    this.visitTimer?.remove()
    this.visitTimer = undefined
  }

  /**
   * The belt's own axis: weigh live game DATA (cognitive fluency, recent
   * struggle, rounds since the last belt) + chance. Returns true when this round
   * rides the belt. Never stacks with a duo (that returned already) and never
   * with a commission.
   */
  private tryInjectConveyor(): boolean {
    const wanted =
      this.forceConveyorNext ||
      shouldInjectConveyor(
        {
          skill: this.skill,
          roundsSinceLastConveyor: this.roundsSinceLastConveyor,
          struggling: this.lastRoundEased,
        },
        Math.random,
      )
    this.forceConveyorNext = false
    if (!wanted) return false
    this.roundsSinceLastConveyor = 0
    return true
  }

  /**
   * Generate + present the round for the current `roundNumber`, once every round
   * MODE gate (commission, duo) has declined it. Also spends the drawn-food
   * callback when its countdown is up: the friend asks for the thing the child
   * drew, by name, as an ordinary count round.
   */
  private dealRound(onBelt = false): void {
    let preferFoodId: string | undefined
    let forceKind: TaskKind | undefined
    if (this.callbackFoodId !== null) {
      if (this.callbackInRounds > 0) this.callbackInRounds--
      else {
        preferFoodId = this.callbackFoodId
        // Force a kind that means "I want THIS one" — the nudge is ignored by
        // kinds where a named food is context (see logic.generateRequest).
        forceKind = this.skill >= 1 ? 'count' : 'single'
        this.callbackFoodId = null
      }
    }

    const round = generateRound({
      round: this.roundNumber,
      skill: this.skill,
      recentKinds: this.recentKinds,
      previous: this.previousRequest,
      foods: this.episodeFoods(),
      forceKind,
      preferFoodId,
      // A kitchen round fills a pot FROM the tray, and the belt is what replaced
      // the tray — the two modes cannot share a round.
      avoidKinds: onBelt ? CONVEYOR_EXCLUDED_KINDS : undefined,
    })
    this.recentKinds.push(round.taskKind)
    if (this.recentKinds.length > 6) this.recentKinds.shift()
    this.presentRound(round, onBelt)
    this.scheduleVisit(onBelt)
  }

  /**
   * Put a generated round on stage: the food source, the round's furniture and
   * the ask. EVERY path that deals a round goes through here — the normal loop,
   * the dev/e2e forceKind, the commission's own round — so a mode can never be
   * left half-dressed (forcing a `dish` kind used to deal the round without ever
   * standing the pot up, which made the round unplayable).
   */
  private presentRound(round: Round, onBelt = false): void {
    this.round = round
    this.previousRequest = round.request
    this.roundStartAt = this.time.now
    if (onBelt) this.conveyorMode.serve(round, beltDials(this.beltSkill))
    else this.tray.buildTray(round.tray)
    // The pot only exists during a kitchen round — a permanent pot would take that
    // ground every round for nothing.
    if (round.request.kind === 'dish') this.kitchenMode.start(round.request)
    else this.kitchenMode.stop()
    this.bubbleUi.showRequest(round.request)
    this.time.delayedCall(450, () => this.bubbleUi.playRequestCue(round.request))
  }

  // ─── The thief ─────────────────────────────────────────────────────────────

  /**
   * Maybe drop a visitor in partway through this round. Scheduled rather than
   * immediate: an interruption that arrives with the request is not an
   * interruption, it is part of the task.
   */
  private scheduleVisit(onBelt: boolean): void {
    this.visitTimer?.remove()
    this.visitTimer = undefined
    this.roundsSinceLastVisit++
    const forced = this.forceVisitorNext
    this.forceVisitorNext = false
    const wanted =
      forced ||
      shouldVisit(
        {
          skill: this.skill,
          roundsSinceLastVisit: this.roundsSinceLastVisit,
          struggling: this.lastRoundEased,
          // A bird landing on a MOVING belt dish stacks two new mechanics on one
          // round; a kitchen round already asks the child to hold a composed goal.
          busy: onBelt || this.duoMode.active || this.commission !== null,
        },
        Math.random,
      )
    if (!wanted) return
    this.roundsSinceLastVisit = 0
    // Land it a beat after the request has been read, and only once per round.
    this.visitTimer = this.time.delayedCall(2200 + Math.random() * 2000, () => {
      if (this.transitioning || this.tray.dragged) return
      this.thiefMode.start(this.thiefSkill)
    })
  }

  /**
   * How a visit went. The thief axis moves on it; the JOURNEY deliberately does
   * not — catching a bird pays joy, never growth or stars, so the game never
   * teaches that reflexes matter more than caring for the friend.
   * @internal Exposed for ThiefMode.
   */
  noteVisitOutcome(outcome: VisitOutcome): void {
    this.thiefSkill = updateThiefSkill(this.thiefSkill, outcome)
    saveSkill(GAME_ID, { thief: this.thiefSkill })
  }

  /**
   * Would feeding this food be correct right now? Used by the thief to prefer a
   * DISTRACTOR: stealing something the child still needs would be the game taking
   * their work away.
   * @internal Exposed for ThiefMode.
   */
  wantsNow(foodId: string): boolean {
    return this.round ? wantsFood(this.round.request, this.eaten, foodId) : false
  }

  /**
   * A plausible food to drop into an emptied plate — one from this round's pool
   * that is not wanted, so a replacement never silently solves the round.
   * @internal Exposed for ThiefMode.
   */
  replacementFood(slot: number): string {
    const pool = activePoolForRound(this.roundNumber, this.episodeFoods())
    const spare = pool.filter((f) => !this.wantsNow(f.id))
    const from = spare.length > 0 ? spare : pool
    return from[(slot + this.roundNumber) % from.length].id
  }

  /**
   * The episode's food pool with the child's drawings SUBSTITUTED in (never
   * appended — see logic.withDrawnFoods for why the length is load-bearing).
   * @internal Exposed for DuoMode via duoGenContext.
   */
  private episodeFoods(): readonly Food[] {
    return this.drawnFoods.length === 0
      ? this.episode.foods
      : withDrawnFoods(this.episode.foods, this.drawnFoods)
  }

  // ─── Commission: "draw me something red" ───────────────────────────────────

  /**
   * The live trigger state, straight off the pure rule — what the dev panel reads
   * so an adult on the device can see why the ask did or did not just fire.
   */
  private commissionGateNow(): {
    dueColor: string | null
    blockedBy: string | null
    lastEpisode: number
    namesColor: boolean
    ownedColors: string[]
  } {
    const ownedColors = this.drawnFoods.map((f) => f.color)
    const gate = commissionGate({
      journey: this.journey,
      lastCommissionEpisode: this.lastCommissionEpisode,
      ownedColors,
    })
    return {
      dueColor: gate.color,
      blockedBy: gate.blockedBy,
      lastEpisode: this.lastCommissionEpisode,
      namesColor: this.skill >= COMMISSION_COLOR_MIN_SKILL,
      ownedColors,
    }
  }

  /**
   * Offer this episode's commission, if one is due. Returns true when the pad is
   * taking over the round: no tray is dealt, the bubble shows the ask instead,
   * and play resumes from `submitCommission`.
   */
  private tryCommission(): boolean {
    // `drawnFoods` is kept newest-first, which is exactly the order the
    // "refresh the oldest slot" rule needs (see journey.commissionColor).
    const ownedColors = this.drawnFoods.map((f) => f.color)
    const forced = this.forceCommissionNext
    this.forceCommissionNext = false
    // The dev/e2e force answers only the WHICH-colour half — it deliberately
    // bypasses the journey gate (episode ≥ 2, once per episode, fresh friend) so
    // an adult can see the beat on demand in episode 1.
    const color = forced
      ? (FOOD_COLORS.find((c) => !ownedColors.includes(c)) ??
        ownedColors[ownedColors.length - 1] ??
        FOOD_COLORS[0])
      : commissionColor({
          journey: this.journey,
          lastCommissionEpisode: this.lastCommissionEpisode,
          ownedColors,
        })
    if (color === null) return false

    // Below the colour-round unlock the ask is simply "draw anything" — a colour
    // the child has not met as a CONCEPT yet is not an ask, it is a riddle.
    const askColor = this.skill >= COMMISSION_COLOR_MIN_SKILL
    this.commission = { color, askColor, asked: false }
    this.round = null
    // The friend arrives with an EMPTY PLATE: nothing to be fed, only something
    // to be given. Any leftover food would also be draggable behind the pad.
    // (The modes themselves are already away — standDownModes runs at the top of
    // every startRound, which is the only way in here.)
    this.tray.clearFoods()
    this.bubbleUi.showCommission(askColor ? color : null)
    // ANNOUNCE FIRST, then hand the screen over. The friend asks while it is still
    // the only thing on stage — pencil in the bubble, a lip smack, its own two-note
    // cue — and only then does the easel rise. Opening the pad on the same frame as
    // the ask was the whole reason this beat read as arbitrary: the easel arrived
    // before the child had seen anyone ask for it. Same shape as the big-bite
    // announcement (see dressBigBite).
    this.monsterRig.lickLips()
    this.time.delayedCall(COMMISSION_ANNOUNCE_MS, () => {
      const live = this.commission
      if (!live || live.asked) return
      // A dev world-rebuild dealt a round underneath the ask: abandon it rather
      // than dropping an easel over a playable tray.
      if (this.round !== null) {
        this.commission = null
        return
      }
      live.asked = true
      this.events.emit('commission', live)
    })
    // The easel covers the friend, so "someone is still waiting" has to live in the
    // strip that stays visible: the ask bubble pulses and chirps. (A lip smack
    // behind the pad is a signal nobody can see.)
    this.impatience?.remove()
    this.impatience = this.time.addEvent({
      delay: 4200,
      loop: true,
      callback: () => this.bubbleUi.nudgeCommission(),
    })
    return true
  }

  /**
   * Dev-only: withdraw a live ask and close the easel, WITHOUT spending the
   * episode's commission (the child never did this — an adult did, to get at the
   * rest of the panel), so the beat can still fire later.
   */
  private withdrawCommission(): void {
    if (!this.commission) return
    this.commission = null
    this.impatience?.remove()
    this.impatience = undefined
    this.events.emit('commission', null)
  }

  /**
   * The child pressed done. A drawing becomes a food and is eaten right now with
   * the celebration turned up; a blank page costs nothing at all — the plate
   * fills with an ordinary food and the round proceeds, and the ask comes back
   * next episode.
   * @internal Called by FeedTheMonsterGame's pad overlay.
   */
  submitCommission(drawing: Drawing | null): void {
    if (!this.commission) return
    const { color, askColor } = this.commission
    this.commission = null
    this.impatience?.remove()
    this.impatience = undefined
    // Asked once per episode whatever the answer: dismissing is two taps, and
    // the day the child says yes is the day the feature works.
    this.lastCommissionEpisode = this.journey.episode
    saveData(GAME_ID, { commissionEpisode: this.lastCommissionEpisode })
    this.events.emit('commission', null)

    const food = drawing ? this.adoptCommission(drawing, askColor ? color : undefined) : null
    if (!food) {
      this.dealRound()
      return
    }

    // Eat it on the spot: one drawn food, nothing else wanted. Built directly
    // (not through the kind registry) because the ONE thing this round must do is
    // put the child's drawing on the tray — five seconds from pencil to chomp.
    this.drawnBiteRound = true
    this.callbackFoodId = food.id
    this.callbackInRounds = DRAWN_CALLBACK_ROUNDS
    this.dealNamedRound(food.id, 1)
  }

  /** File a finished commission, register it, and put it in the rotation. */
  private adoptCommission(drawing: Drawing, asked?: FoodColor): Food | null {
    const provisional = adoptDrawing(this, drawing, {
      dpr: this.dpr,
      foodCss: FOOD_CSS,
      color: asked,
    })
    if (!provisional) return null
    // Stamp the effective colour so "six slots, one per colour" stays exact — the
    // ask when there was one, the drawing's own modal colour otherwise.
    stampDrawnFood(drawing, provisional.color)
    // Newest first (matches artStore.newestPerTag, and drives which slot a later
    // commission refreshes once all six colours are owned).
    this.drawnFoods = [provisional, ...this.drawnFoods.filter((f) => f.color !== provisional.color)]
    return provisional
  }

  /** A plain "N of this food" round about one specific food, tray guaranteed. */
  private dealNamedRound(foodId: string, count: number): void {
    const request: FoodRequest = { kind: 'count', entries: [{ foodId, count }] }
    const pool = poolWithFood(
      activePoolForRound(this.roundNumber, this.episodeFoods()),
      foodId,
      this.episodeFoods(),
    )
    this.presentRound({
      round: this.roundNumber,
      taskKind: count === 1 ? 'single' : 'count',
      request,
      tray: generateTray(request, pool, Math.random),
    })
  }

  /**
   * The second axis: weigh live game DATA (skill, recent struggle, episode slots
   * left) + chance and, if it fires, hand the "next friend" to the duo bonus
   * controller instead. Returns true when a duo took over the round.
   */
  private tryInjectDuo(): boolean {
    const slotsLeft = FRIENDS_PER_EPISODE - this.journey.friendsFed
    if (slotsLeft < 2) {
      this.forceDuoNext = false
      return false
    }
    const ctx: DuoContext = {
      skill: this.skill,
      roundsSinceLastDuo: this.roundsSinceLastDuo,
      struggling: this.lastRoundEased,
      slotsLeft,
    }
    if (!this.forceDuoNext && !shouldInjectDuo(ctx, Math.random)) return false
    this.forceDuoNext = false
    this.roundsSinceLastDuo = 0
    this.duoMode.start()
    return true
  }

  // ─── Big bite ──────────────────────────────────────────────────────────────

  /**
   * Flip the current round's big-bite state. The FLAG moves at once (so a round
   * completing in the next frame still pays the +2), while the presentation can
   * be deferred by `delayMs` — a mid-round upgrade waits for the spit-back
   * reaction to finish so the two mouth animations never fight.
   */
  private setBigBite(on: boolean, delayMs = 0): void {
    if (on === this.bigBite) return
    this.bigBite = on
    if (delayMs <= 0) {
      this.dressBigBite(on)
      return
    }
    this.time.delayedCall(delayMs, () => {
      if (this.bigBite === on) this.dressBigBite(on)
    })
  }

  /**
   * The whole picture-only announcement, in three layers: the friend smacks its
   * lips over a tummy rumble (the moment), the tray slots light up gold with a
   * shimmer travelling along the row (the state), and every food grows (the
   * instant read). Undressing just reverses all three.
   */
  private dressBigBite(on: boolean): void {
    this.tray.setBigBite(on)
    if (on) this.monsterRig.lickLips()
  }

  /** @internal Round-generation context DuoMode feeds to generateDuoRound. */
  duoGenContext(): { round: number; skill: number; foods: readonly Food[] } {
    return { round: this.roundNumber, skill: this.skill, foods: this.episodeFoods() }
  }

  /** @internal Bank a completed duo round into the adaptive meter, exactly like
   * a solo round — a duo still teaches the difficulty engine. */
  bankDuoRound(spitBacks: number, ms: number): void {
    this.applyMeter(spitBacks, ms)
  }

  /** @internal Resume solo play after a duo pair has walked off. */
  resumePlay(): void {
    this.startRound(this.roundNumber + 1)
  }

  /** One adaptive-meter step for a completed round (solo or duo), saved. */
  private applyMeter(spitBacks: number, ms: number): void {
    this.skill = updateSkill(this.skill, { spitBacks, ms }, this.skillPeak)
    this.skillPeak = Math.max(this.skillPeak, this.skill)
    this.lastRoundEased = spitBacks >= SPIT_BACKS_BEFORE_EASE
    saveSkill(GAME_ID, { cognitive: this.skill })
    // The belt's axis moves only on belt rounds, and on its own signal: wanted
    // dishes that rode past un-taken. That is timing and sustained scanning —
    // the thing the belt exists to train — not colour discrimination.
    if (this.conveyorMode.active) {
      this.beltSkill = updateBeltSkill(this.beltSkill, {
        missedPasses: this.conveyorMode.misses,
        spitBacks,
      })
      saveSkill(GAME_ID, { belt: this.beltSkill })
    }
  }

  // ─── Feeding ─────────────────────────────────────────────────────────────

  /**
   * The feed drop target(s) this round: one mouth in a normal round, two in a
   * duo bonus round. The tray's drag magnetics + drop routing iterate these, so
   * it never has to know whether one friend or two are on stage.
   * @internal Exposed for Tray (its drag/dragend read these).
   */
  feedMouths(): FeedMouth[] {
    if (this.duoMode.active) return this.duoMode.mouths()
    const world = this.monsterRig.mouthWorld()
    const targets: FeedMouth[] = [
      {
        x: world.x,
        y: world.y,
        isOpen: () => this.monsterRig.mouthOpen,
        setOpen: (target, ms) => this.monsterRig.setMouthOpen(target, ms),
        accept: (img) => this.feed(img),
      },
    ]
    // In a kitchen round the pot is a second drop target: the child fills it, then
    // feeds what comes out. The friend still refuses raw parts (wantsFood accepts
    // only the cooked dish), so there is one right thing to do at every moment.
    const pot = this.kitchenMode.dropTarget()
    if (pot) targets.push(pot)
    return targets
  }

  /**
   * The pot spat a wrong part back. It counts as a cognitive slip exactly like a
   * mouth spit-back: it is the same mistake (this thing does not belong here), and
   * the meter should hear it.
   * @internal Exposed for KitchenMode.
   */
  notePotReject(): void {
    this.spitBacks++
    this.friendSpitBacks++
    if (isStuck(this.friendSpitBacks)) this.setBigBite(true, 700)
    this.funnyUntil = this.time.now + 500
    this.monsterRig.squintEyes()
  }

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
    // A belt dish leaving for good turns its lane into a gap the scheduler
    // refills when it next comes round past the hatch; a cooked dish leaving means
    // the pot's job is done.
    this.conveyorMode.noteEaten(img)
    this.kitchenMode.noteEaten(img)
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
    // lost, never punished — but it IS the meter's cognitive error signal
    // (per round) and the big-bite catch-up signal (per friend).
    this.spitBacks++
    this.friendSpitBacks++
    // The catch-up, live: enough wrong feeds on this friend and the round
    // UPGRADES to a big bite mid-play — the friend visibly gets hungrier and the
    // tray lights up, so the child sees the game come to meet them instead of
    // grinding the +1/−1 treadmill. Deferred past the "blegh" so the two mouth
    // animations don't fight; the flag itself flips now.
    if (isStuck(this.friendSpitBacks)) this.setBigBite(true, 700)
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

    // A LIVE home, re-read every frame: on the belt the plate a rejected dish
    // belongs on has not stopped riding while the friend pulled its face.
    const base = this.tray.foodBaseScale(img)
    this.tray.arcTo(
      img,
      () => this.tray.homePos(img),
      550,
      () => {
        img.setInteractive()
        if (this.transitioning) this.tray.fadeOutFood(img)
      },
    )
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
    // No visitor may share the stage with a celebration: the child's attention is
    // owed to the friend growing, and a bird landing mid-confetti reads as chaos.
    this.visitTimer?.remove()
    this.visitTimer = undefined
    this.thiefMode.cancel()

    // Leftover distractors tumble away.
    this.tray.foods.forEach((food, i) => {
      if (food === this.tray.dragged || this.tweens.isTweening(food)) return
      this.time.delayedCall(150 + i * 40, () => this.tray.fadeOutFood(food))
    })

    // Burp + confetti. Eating a brand-new DRAWING gets a bigger reaction than
    // any normal bite — that beat ("I made this and it got used, now") is the
    // whole emotional payload of the commission, so it must not read as ordinary.
    const mp = this.monsterPos()
    const drawnBite = this.drawnBiteRound
    this.time.delayedCall(250, () => {
      playTone(98, 220, 'sawtooth', 0.09)
      this.time.delayedCall(170, () => playTone(78, 190, 'sawtooth', 0.07))
      this.confetti.explode(drawnBite ? 110 : 60, mp.x, mp.y - this.bodyR * this.growth)
      this.monsterRig.beHappy(drawnBite ? 1600 : 900) // laugh with the confetti (guards its own revert on rebuild)
      if (drawnBite) {
        this.stars.explode(24, mp.x, mp.y - this.bodyR * this.growth)
        ;[523, 659, 784, 1047, 1319].forEach((freq, i) =>
          this.time.delayedCall(180 + i * 110, () => playTone(freq, 200, 'triangle', 0.11)),
        )
      }
    })

    // Round fed = level passed: one persistent star on the launcher tile.
    addStars(GAME_ID)

    // Adaptive nudge: spit-backs and round time steer the cognitive meter,
    // saved every round so the next session resumes near this one.
    this.applyMeter(this.spitBacks, this.time.now - this.roundStartAt)

    // The journey advances on care performed: this fed round grows the friend
    // one visible step — or two on a "big bite" — or crowns it / completes the
    // episode. The big bite was decided (and shown to the child) back when the
    // round started, or upgraded live in spitBack; here it is only cashed in.
    const bigBite = this.bigBite
    const { next, outcome } = feedStep(this.journey, bigBite ? BIG_BITE : NORMAL_BITE)
    this.journey = next
    saveData(GAME_ID, journeyToData(this.journey))
    // A big bite that fired because the child was stuck has paid off the debt —
    // clear it so the boost is a one-off recovery, not a per-round crutch. When
    // the friend changes below, the fresh friend starts clean regardless.
    if (bigBite) this.friendSpitBacks = 0

    if (outcome === 'grew') {
      // Visible growth pop: clearly bigger + a brighter aura (a big bite pops
      // harder + rings a brighter sparkle so the "double" reads).
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
        if (bigBite) {
          const mp = this.monsterPos()
          this.stars.explode(18, mp.x, mp.y - this.bodyR * this.growth)
        }
        const chime = bigBite ? [523, 659, 784, 1047] : [523, 659, 784]
        this.time.delayedCall(300, () =>
          chime.forEach((freq, i) =>
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

    // A fresh friend is hopping in — it starts its big-bite tally clean.
    this.friendSpitBacks = 0

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

  update(_time: number, delta: number): void {
    // 100% monster pupil tracking — delegated to the rig (the lineup minis
    // deliberately do NOT track; they idle-glance on their own timers). In a
    // duo, the right friend's rig tracks too (the left one IS monsterRig).
    this.monsterRig.update()
    if (this.duoMode.active) this.duoMode.update()
    if (this.conveyorMode.active) this.conveyorMode.update(delta)
    // The bird's shadow and the food in its claws are pinned to the bird here, per
    // frame: anything tweened on its own path drifts away from the bird it belongs
    // to (which is exactly how the shadow ended up on the wrong side of the plate).
    if (this.thiefMode.active) this.thiefMode.update()
  }

  /** Ambient growth sparkles for the walker (and the duo's right friend). */
  private tickAuras = (): void => {
    this.monsterRig.tickAura()
    if (this.duoMode.active) this.duoMode.tickAura()
  }
}

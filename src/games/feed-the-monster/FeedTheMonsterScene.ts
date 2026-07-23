import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { initLevel, reportLevel } from '../../shared/level'
import { addStars, loadProgress, saveData, saveSkill, sessionStart } from '../../shared/progress'
import { onViewportResize, safeAreaInset, viewportSize } from '../../shared/viewport'
import {
  SKILL_MAX,
  SKILL_START,
  TRAY_SIZE,
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
import { artEntries, artKey, friendSpec } from './art'
import type { FeedTestApi } from './testHook'
import * as layout from './layout'
import type { LayoutMetrics, XY } from './layout'
import * as textures from './textures'
import { RequestBubble } from './requestBubble'
import { MonsterRig } from './monsterRig'

/** Registry id — also the key the shared progress store files this under. */
const GAME_ID = 'feed-the-monster'

// ART SPEC palette (episode palettes override the scenery at runtime). INK is
// shared with the lineup minis (spawnMini); the walker's face ink + PINK blush
// moved with MonsterRig (see monsterRig.ts).
const INK = 0x3d3a4b
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
  private minis: Phaser.GameObjects.Container[] = []

  private bgGfx!: Phaser.GameObjects.Graphics
  private bgImage!: Phaser.GameObjects.Image

  /**
   * The feedable friend (body, growth aura, face, all its animations/reactions
   * + the per-frame pupil tracking). Owns its own display objects; reads live
   * scene state through the passed `this`. See ./monsterRig.
   */
  private readonly monsterRig = new MonsterRig(this)
  /**
   * Lineup minis' pupils (node + its eye container) for pointer tracking.
   * @internal Exposed for MonsterRig (its scheduleBlink blinks the lineup too).
   */
  miniPupils: Array<{
    node: Phaser.GameObjects.Container
    eye: Phaser.GameObjects.Container
  }> = []

  /**
   * The task-request bubble (top panel + tiles/pips/sockets/bans/ring/✓ + the
   * audio cue). Owns its own display objects; reads live scene state through
   * the passed `this`. See ./requestBubble.
   */
  private readonly bubbleUi = new RequestBubble(this)

  private plates: Phaser.GameObjects.Image[] = []
  private foods: Phaser.GameObjects.Image[] = []
  /** @internal Exposed for MonsterRig (its update tracks the dragged food). */
  dragged: Phaser.GameObjects.Image | null = null

  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter
  private stars!: Phaser.GameObjects.Particles.ParticleEmitter
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
    this.buildPlates()
    this.bubbleUi.build()
    this.buildEmitters()
    this.wireInput()

    // Restore the fed-friends lineup, no fanfare (build already lit the
    // current friend's aura to its growth step).
    for (let i = 0; i < this.journey.friendsFed; i++) this.spawnMini(i)

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
        foods: this.foods.map((f) => ({
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
    textures.buildSceneTextures(this, {
      dpr: this.dpr,
      bodyR: this.bodyR,
      episode: this.episode,
      color: this.friendBodyColor(),
      foodCss: FOOD_CSS,
    })
    for (const mini of this.minis) {
      this.tweens.killTweensOf(mini)
      mini.destroy()
    }
    this.minis = []
    for (let i = 0; i < this.journey.friendsFed; i++) this.spawnMini(i)
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
    this.buildTray(round.tray)
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

  /**
   * Texture for a food: reskin sprite when shipped, emoji strike otherwise.
   * @internal Exposed for RequestBubble (tile/slot fills).
   */
  foodTexture(foodId: string): string {
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

  // ─── Fed-friends lineup + friend/episode transitions ───────────────────────

  /**
   * Fed friends huddle together as a cozy pile in the bottom-left corner —
   * they overlap and stack (a heap, not a spread-out lineup). Offsets are in
   * bodyR units, anchored to the shared heroBaseline so the pile tracks the
   * hero (and the tray) proportionally on every screen.
   */
  private miniSlot(index: number): XY {
    return layout.miniSlot(this.metrics(), index)
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
      : this.add.image(0, -r * 0.1, textures.monsterTexture(this, color, this.bodyR))
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
    const halo = this.add
      .image(0, -r * 0.1, 'ftm-halo')
      .setTint(this.monsterRig.lighten(color, 0.55))
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

  /**
   * The grown friend celebrates and walks aside to join the lineup; then the
   * whole lineup dances to welcome the newcomer before the next friend arrives.
   * On the fifth friend the dance is grander and hands off to the next episode.
   * `onResume` restarts play once the new (or next-episode) friend is on stage.
   */
  private friendGrownSequence(danceParty: boolean, onResume: () => void): void {
    const mp = this.monsterPos()
    // Star shower + a proud jump.
    this.stars.explode(16, mp.x, mp.y - this.bodyR * this.growth)
    ;[523, 659, 784, 1047].forEach((freq, i) =>
      this.time.delayedCall(i * 120, () => playTone(freq, 160, 'triangle', 0.1)),
    )
    this.tweens.add({
      targets: this.monsterRig.container,
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
        targets: this.monsterRig.container,
        x: slot.x,
        y: slot.y,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 700,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          // …swap the walker for a lineup mini…
          this.monsterRig.container.destroy()
          const mini = this.spawnMini(grownIndex, episodeAtGrow)
          mini.setScale(0)
          this.tweens.add({
            targets: mini,
            scaleX: 0.3,
            scaleY: 0.3,
            duration: 260,
            ease: 'Back.easeOut',
          })
          // …then the whole lineup dances to greet the new friend. Only after
          // the dance does the next friend hop in (or, on the fifth, the world
          // turns over to the next episode).
          const danceMs = this.celebrateLineup(danceParty)
          this.time.delayedCall(danceMs + 300, () => {
            if (danceParty) this.episodeTransition(onResume)
            else this.nextFriendEnters(onResume)
          })
        },
      })
    })
  }

  /** A brand-new small friend hops in from the side, then play resumes. */
  private nextFriendEnters(onResume: () => void): void {
    this.growth = scaleForStep(this.journey.growthStep)
    this.monsterRig.build()

    const mp = this.monsterPos()
    this.monsterRig.container.setPosition(this.scale.width + this.bodyR, mp.y)
    this.tweens.add({
      targets: this.monsterRig.container,
      x: mp.x,
      duration: 600,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.layout()
        onResume()
      },
    })
    playTone(659, 90, 'sine', 0.08)
    this.time.delayedCall(110, () => playTone(880, 110, 'sine', 0.08))
  }

  /**
   * The fed friends in the lineup dance — a staggered bounce-and-wobble wave
   * with confetti, stars and a little melody. Played every time a friend joins
   * (light) and again, grander, when the fifth completes the episode. Returns
   * the wave's duration in ms so the caller can time what comes next.
   */
  private celebrateLineup(grand: boolean): number {
    const cx = this.scale.width / 2
    const repeat = grand ? 3 : 1
    const waves = grand ? [0, 1] : [0]
    waves.forEach((wave) => {
      this.time.delayedCall(wave * 900, () => {
        this.confetti.explode(grand ? 50 : 26, cx * 0.5, this.px(90))
        this.confetti.explode(grand ? 50 : 26, cx * 1.5, this.px(90))
        this.stars.explode(grand ? 12 : 8, cx, this.px(140))
      })
    })
    // A little party melody — a longer flourish for the episode finale.
    const melody = grand ? [523, 659, 784, 659, 880, 784, 1047] : [523, 659, 784, 1047]
    melody.forEach((freq, i) =>
      this.time.delayedCall(i * 180, () => playTone(freq, 150, 'triangle', 0.1)),
    )
    // Everyone bounces + wobbles in a staggered wave.
    this.minis.forEach((mini, i) => {
      this.tweens.add({
        targets: mini,
        y: mini.y - this.px(46),
        delay: i * 130,
        duration: 260,
        yoyo: true,
        repeat,
        ease: 'Quad.easeOut',
      })
      this.tweens.add({
        targets: mini,
        angle: { from: -8, to: 8 },
        delay: i * 130,
        duration: 260,
        yoyo: true,
        repeat,
        ease: 'Sine.easeInOut',
        onComplete: () => mini.setAngle(0),
      })
    })

    const lastDelay = Math.max(this.minis.length - 1, 0) * 130
    return lastDelay + 260 * 2 * (repeat + 1)
  }

  /** Soft white fade → new palette, food pool, fresh lineup, first friend. */
  private episodeTransition(onResume: () => void): void {
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
        textures.buildSceneTextures(this, {
          dpr: this.dpr,
          bodyR: this.bodyR,
          episode: this.episode,
          color: this.friendBodyColor(),
          foodCss: FOOD_CSS,
        })
        for (const mini of this.minis) {
          this.tweens.killTweensOf(mini)
          mini.destroy()
        }
        this.minis = []
        this.miniPupils = []
        this.growth = scaleForStep(this.journey.growthStep)
        this.monsterRig.build()
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
          onComplete: () => {
            veil.destroy()
            onResume()
          },
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
    const w = layout.plateWidth(this.metrics())
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
        const mouth = this.monsterRig.mouthWorld()
        const dist = Phaser.Math.Distance.Between(img.x, img.y, mouth.x, mouth.y)
        if (dist < this.snapRadius()) {
          img.x += (mouth.x - img.x) * 0.3
          img.y += (mouth.y - img.y) * 0.3
          if (this.monsterRig.mouthOpen < 0.9) this.monsterRig.setMouthOpen(1, 120)
        } else if (this.monsterRig.mouthOpen > 0.1) {
          this.monsterRig.setMouthOpen(0, 160)
        }
      },
    )

    this.input.on(
      'dragend',
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const img = obj as Phaser.GameObjects.Image
        if (img !== this.dragged) return
        this.dragged = null
        const mouth = this.monsterRig.mouthWorld()
        const dist = Phaser.Math.Distance.Between(img.x, img.y, mouth.x, mouth.y)
        if (dist < this.snapRadius() && !this.transitioning) {
          this.feed(img)
        } else {
          this.monsterRig.setMouthOpen(0, 160)
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
  /** Live snapshot the pure ./layout geometry reads from. */
  private metrics(): LayoutMetrics {
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
    this.monsterRig.container.setPosition(mp.x, mp.y)
    this.bubbleUi.reposition()

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

  // ─── Mouth helpers ───────────────────────────────────────────────────────

  /**
   * Generous drop zone, centered on the visible mouth (mouthWorld). Slightly
   * roomier than a tight mouth radius so a 3–4yo who releases a touch above the
   * open mouth still lands the food — the open-mouth cue and the feed test share
   * this exact zone, so "mouth looks open" always means "will feed".
   */
  private snapRadius(): number {
    return layout.snapRadius(this.metrics())
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
    this.bubbleUi.showRequest(round.request)
    this.time.delayedCall(450, () => this.bubbleUi.playRequestCue(round.request))
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
          : this.px(FOOD_CSS * 1.12) / Math.max(frame.width, frame.height)) *
        textures.foodScale(foodId)
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

  // ─── Feeding ─────────────────────────────────────────────────────────────

  private feed(img: Phaser.GameObjects.Image): void {
    img.disableInteractive()
    this.monsterRig.setMouthOpen(1, 80)
    this.tweens.killTweensOf(img)
    const mouth = this.monsterRig.mouthWorld()
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
      this.friendGrownSequence(outcome === 'episode-complete', resume),
    )
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

  // ─── Per-frame: pupils track the food / last touch ───────────────────────

  update(): void {
    // 100% monster pupil tracking — delegated to the rig (the lineup minis
    // deliberately do NOT track; they idle-glance on their own timers).
    this.monsterRig.update()
  }
}

/**
 * The DUO bonus round — two little friends side by side, each wanting its own
 * food, fed from ONE shared tray. Clearing a round grows BOTH one synchronized
 * step; after journey.DUO_GROW_STEPS the pair is full and walks to the lineup
 * together as two friends at once. It is a deliberate pace + variety burst
 * (two friends grown in three rounds vs 2×GROW_STEPS solo), injected on its own
 * data+chance axis (logic.shouldInjectDuo), never by the difficulty meter.
 *
 * Factored into its own widget so the polished SOLO round flow in the scene is
 * left untouched — the scene just delegates to `new DuoMode(this)` when a duo is
 * live. DuoMode owns the second friend's rig + the two per-friend bubbles and
 * reuses the scene's left rig (monsterRig), shared tray, particle emitters and
 * journey/celebration helpers back through the passed scene reference.
 */
import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { addStars, saveData } from '../../shared/progress'
import { DUO_GROW_STEPS, duoComplete, duoFeedStep, duoScaleForStep, journeyToData } from './journey'
import { generateDuoRound, isRoundComplete, wantsFood } from './logic'
import type { CountRequest, DuoRound } from './logic'
import * as layout from './layout'
import * as textures from './textures'
import { MonsterRig } from './monsterRig'
import type { DuoState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

const GAME_ID = 'feed-the-monster'
// Pentatonic-ish happy tones, mirrored from the scene (the duo shares the count
// beep + grow chime — see monsterRig.ts for the same duplicate-const pattern).
const PENTA = [523, 587, 659, 784, 880]

/** A tiny thought bubble above one duo friend: the food it wants, `count` tiles
 * that ghost until fed then stamp a ✓. Simpler than the full RequestBubble — a
 * duo side is always a plain "N of this food" ask. */
class DuoBubble {
  private readonly scene: FeedTheMonsterScene
  private container: Phaser.GameObjects.Container
  private tiles: Phaser.GameObjects.Image[] = []

  constructor(scene: FeedTheMonsterScene, request: CountRequest, x: number, y: number) {
    this.scene = scene
    this.container = scene.add.container(x, y).setDepth(7)

    const foodId = request.entries[0].foodId
    const count = request.entries[0].count
    const px = (css: number): number => css * scene.dpr
    const tileW = px(38)
    const gap = px(8)
    const padX = px(14)
    const padY = px(10)
    const w = count * tileW + (count - 1) * gap + padX * 2
    const h = tileW + padY * 2

    const g = scene.add.graphics()
    g.fillStyle(0xffffff, 0.96)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, px(16))
    g.lineStyle(px(4), scene.episode.palette.table, 1)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, px(16))
    // A little tail pointing down at the friend.
    g.fillStyle(0xffffff, 0.96)
    g.fillTriangle(-px(8), h / 2 - px(1), px(8), h / 2 - px(1), 0, h / 2 + px(12))
    this.container.add(g)

    const tex = scene.tray.foodTexture(foodId)
    const size = tileW * textures.foodScale(foodId)
    for (let i = 0; i < count; i++) {
      const tx = (i - (count - 1) / 2) * (tileW + gap)
      const tile = scene.add.image(tx, 0, tex).setDisplaySize(size, size).setAlpha(0.5)
      this.container.add(tile)
      this.tiles.push(tile)
    }

    this.container.setScale(0)
    scene.tweens.add({
      targets: this.container,
      scaleX: 1,
      scaleY: 1,
      duration: 300,
      ease: 'Back.easeOut',
    })
  }

  /** Solidify tiles up to `fed` and stamp each with a ✓ (idempotent). */
  markFed(fed: number): void {
    for (let i = 0; i < Math.min(fed, this.tiles.length); i++) {
      const tile = this.tiles[i]
      if (tile.getData('fed')) continue
      tile.setData('fed', true)
      tile.setAlpha(1)
      this.scene.tweens.add({
        targets: tile,
        scaleX: { from: tile.scaleX * 1.25, to: tile.scaleX },
        scaleY: { from: tile.scaleY * 1.25, to: tile.scaleY },
        duration: 220,
        ease: 'Back.easeOut',
      })
      const badge = this.scene.add
        .image(tile.x, tile.y, 'ftm-check')
        .setDisplaySize(tile.displayWidth * 0.5, tile.displayWidth * 0.5)
        .setAlpha(0.85)
      this.container.add(badge)
      this.scene.tweens.add({
        targets: badge,
        scaleX: { from: 0, to: badge.scaleX },
        scaleY: { from: 0, to: badge.scaleY },
        duration: 220,
        ease: 'Back.easeOut',
      })
    }
  }

  reposition(x: number, y: number): void {
    this.container.setPosition(x, y)
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.container)
    this.container.destroy()
  }
}

/** One duo friend's live state: rig, its request, and what it has eaten. */
interface DuoFriend {
  side: -1 | 1
  rig: MonsterRig
  request: CountRequest
  eaten: string[]
  bubble: DuoBubble
}

/**
 * A tray drop target — one per open mouth in a normal or duo round, plus the
 * kitchen's pot when one is on the table. The tray routes a released food to the
 * NEAREST target inside its snap radius and hands it over; nothing about the drag
 * has to know whether it is feeding a friend or filling a pot.
 */
export interface FeedMouth {
  x: number
  y: number
  isOpen: () => number
  setOpen: (target: number, ms: number) => void
  accept: (img: Phaser.GameObjects.Image) => void
  /**
   * Drop radius for THIS target, when it differs from the mouth's default
   * (layout.snapRadius) — the pot's zone is its own size, not the friend's.
   */
  snap?: number
}

export class DuoMode {
  /** True while a duo round is on stage (the scene routes feeds here). */
  active = false

  private readonly scene: FeedTheMonsterScene
  private step = 0
  private friends: DuoFriend[] = []
  /** The second friend's rig (the left friend reuses the scene's monsterRig). */
  private rigRight!: MonsterRig
  /** This duo round's meter inputs (timing + wrong feeds), banked on complete. */
  private roundStartAt = 0
  private roundSpitBacks = 0

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  // ─── Start / round setup ───────────────────────────────────────────────────

  /** Begin a duo bonus: build the two friends and deal the first shared tray. */
  start(): void {
    this.active = true
    this.step = 0
    // Stand the solo round down: null its round so the solo feed path can never
    // fire on the (about-to-be-rebuilt) rig, and hide its task panel.
    this.scene.round = null
    this.scene.bubbleUi.setHidden(true)

    const baseIndex = this.scene.journey.friendsFed

    // Left friend reuses the scene's walker rig; right friend is our own.
    const leftRig = this.scene.monsterRig
    leftRig.duo = { friendIndex: baseIndex, homeX: 0, step: 0 }
    leftRig.build()
    this.rigRight = new MonsterRig(this.scene)
    this.rigRight.duo = { friendIndex: baseIndex + 1, homeX: 0, step: 0 }
    this.rigRight.build()

    const blank: CountRequest = { kind: 'count', entries: [] }
    this.friends = [
      { side: -1, rig: leftRig, request: blank, eaten: [], bubble: null! },
      { side: 1, rig: this.rigRight, request: blank, eaten: [], bubble: null! },
    ]
    this.dealRound()
    this.placeFriends()

    // Both little friends hop in together (covers the swap from the solo walker).
    for (const friend of this.friends) {
      friend.rig.container.setScale(0)
      this.scene.tweens.add({
        targets: friend.rig.container,
        scaleX: duoScaleForStep(0),
        scaleY: duoScaleForStep(0),
        duration: 440,
        delay: friend.side < 0 ? 0 : 90,
        ease: 'Back.easeOut',
      })
    }
    playTone(659, 90, 'sine', 0.08)
    this.scene.time.delayedCall(110, () => playTone(880, 110, 'sine', 0.08))
  }

  /**
   * Dev-only: take a live duo off stage without graduating anyone. The caller
   * hands the world back to solo play (see the scene's devTakeStage, which
   * rebuilds the walker at the live journey point and deals it a round).
   *
   * The `?dev` overlay needs this because a duo nulls the scene's round for as
   * long as it runs, and every force is gated on a live round — so an adult who
   * taps a mode button during a duo got nothing at all, from every button, for
   * the whole duo. Only reachable when nothing is mid-celebration, so no duo
   * timer chain is in flight here (dealRound guards anyway).
   */
  abort(): void {
    if (!this.active) return
    this.active = false
    for (const friend of this.friends) {
      friend.bubble?.destroy()
      // The LEFT rig is the scene's own walker — it is reused, never destroyed.
      if (friend.rig === this.scene.monsterRig) continue
      this.scene.tweens.killTweensOf(friend.rig.container)
      friend.rig.container.destroy()
    }
    this.friends = []
    this.scene.monsterRig.duo = null
  }

  /** Deal one of the three duo rounds: fresh foods, fresh tray, fresh bubbles. */
  private dealRound(): void {
    // An aborted duo may still have this queued behind a celebration; dealing
    // here would build a duo tray over whatever is on stage now.
    if (!this.active) return
    // A fresh round is feedable again — clear the celebration guard so drops
    // (and friend taps) are live once more, exactly like the solo startRound.
    this.scene.transitioning = false
    const round: DuoRound = generateDuoRound(this.scene.duoGenContext())
    const sides: CountRequest[] = [round.left, round.right]
    this.friends.forEach((friend, i) => {
      friend.request = sides[i]
      friend.eaten = []
      friend.bubble?.destroy()
      const pos = this.friendPos(friend.side)
      friend.bubble = new DuoBubble(this.scene, sides[i], pos.x, this.bubbleY(pos.y))
    })
    this.roundStartAt = this.scene.time.now
    this.roundSpitBacks = 0
    this.scene.tray.buildTray(round.tray)
    this.playCue()
  }

  private playCue(): void {
    // One beep per friend's total, left then right — "this many here, this many there".
    this.friends.forEach((friend, fi) => {
      const total = friend.request.entries.reduce((s, e) => s + e.count, 0)
      for (let i = 0; i < Math.min(total, PENTA.length); i++) {
        this.scene.time.delayedCall(fi * 500 + i * 160, () => playTone(PENTA[i], 150, 'sine', 0.09))
      }
    })
  }

  // ─── Layout ────────────────────────────────────────────────────────────────

  private friendPos(side: -1 | 1): { x: number; y: number } {
    return layout.duoMonsterPos(this.scene.metrics(), side, duoScaleForStep(this.step))
  }

  private bubbleY(friendY: number): number {
    return friendY - this.scene.bodyR * duoScaleForStep(this.step) * 1.55 - this.px(30)
  }

  /** Position both rigs + bubbles for the current growth step (also on resize). */
  placeFriends(): void {
    for (const friend of this.friends) {
      const pos = this.friendPos(friend.side)
      friend.rig.duo = { friendIndex: friend.rig.duo!.friendIndex, homeX: pos.x, step: this.step }
      friend.rig.container.setPosition(pos.x, pos.y)
      friend.bubble?.reposition(pos.x, this.bubbleY(pos.y))
    }
  }

  // ─── Feeding ───────────────────────────────────────────────────────────────

  /** The two drop targets — one mouth per friend — for the tray's drag routing. */
  mouths(): FeedMouth[] {
    return this.friends.map((friend) => {
      const world = friend.rig.mouthWorld()
      return {
        x: world.x,
        y: world.y,
        isOpen: () => friend.rig.mouthOpen,
        setOpen: (t, ms) => friend.rig.setMouthOpen(t, ms),
        accept: (img) => this.feed(img, friend),
      }
    })
  }

  private feed(img: Phaser.GameObjects.Image, friend: DuoFriend): void {
    img.disableInteractive()
    friend.rig.setMouthOpen(1, 80)
    this.scene.tweens.killTweensOf(img)
    const mouth = friend.rig.mouthWorld()
    const base = this.scene.tray.foodBaseScale(img)
    this.scene.tweens.add({
      targets: img,
      x: mouth.x,
      y: mouth.y,
      scaleX: base * 0.3,
      scaleY: base * 0.3,
      duration: 130,
      ease: 'Quad.easeIn',
      onComplete: () => this.swallow(img, friend),
    })
  }

  private swallow(img: Phaser.GameObjects.Image, friend: DuoFriend): void {
    if (!this.active) {
      img.destroy()
      return
    }
    const foodId = img.getData('foodId') as string
    if (wantsFood(friend.request, friend.eaten, foodId)) this.eatCorrect(img, friend)
    else this.spitBack(img, friend)
  }

  private eatCorrect(img: Phaser.GameObjects.Image, friend: DuoFriend): void {
    friend.eaten.push(img.getData('foodId') as string)
    this.scene.tray.foods = this.scene.tray.foods.filter((f) => f !== img)
    img.destroy()

    friend.rig.setMouthOpen(0, 70)
    const g = duoScaleForStep(this.step)
    this.scene.tweens.add({
      targets: friend.rig.container,
      scaleX: g * 1.18,
      scaleY: g * 0.84,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => friend.rig.container.setScale(g),
    })
    playTone(196, 70, 'square', 0.08)
    const step = Math.min(friend.eaten.length - 1, PENTA.length - 1)
    this.scene.time.delayedCall(120, () => playTone(PENTA[step], 170, 'sine', 0.12))
    friend.bubble.markFed(friend.eaten.length)

    if (this.friends.every((f) => isRoundComplete(f.request, f.eaten))) this.completeRound()
  }

  private spitBack(img: Phaser.GameObjects.Image, friend: DuoFriend): void {
    // A wrong feed in a duo is a gentle "not me" — spit back, no shrink (the
    // duo is a short bonus, kept light). It still feeds the meter (banked below).
    this.roundSpitBacks++
    playTone(220, 200, 'sine', 0.07)
    this.scene.time.delayedCall(110, () => playTone(165, 170, 'sine', 0.06))
    this.scene.funnyUntil = this.scene.time.now + 600
    friend.rig.setMouthOpen(0.45, 90)
    this.scene.time.delayedCall(240, () => friend.rig.setMouthOpen(0, 140))
    friend.rig.squintEyes()
    friend.rig.shakeHead()

    const base = this.scene.tray.foodBaseScale(img)
    this.scene.tray.arcTo(
      img,
      () => this.scene.tray.homePos(img),
      520,
      () => {
        img.setInteractive()
        if (!this.active) this.scene.tray.fadeOutFood(img)
      },
    )
    this.scene.tweens.add({
      targets: img,
      scaleX: base,
      scaleY: base,
      duration: 380,
      ease: 'Quad.easeOut',
    })
  }

  // ─── Round complete → grow both, or graduate the pair ────────────────────────

  private completeRound(): void {
    // Freeze incidental interactions for the whole celebration — grow-pop, and
    // (on the final round) graduate → walk-off → finish. Without this a toddler
    // tapping a celebrating friend would giggle()→killTweensOf(monster), severing
    // the walk-off tween whose onComplete is the ONLY path to finish() → a
    // permanent soft-lock. dealRound() / the resume startRound() clear it again.
    // (Mirrors the solo completeRound's transitioning=true.)
    this.scene.transitioning = true
    // Leftover distractors tumble away.
    this.scene.tray.foods.forEach((food, i) => {
      if (this.scene.tweens.isTweening(food)) return
      this.scene.time.delayedCall(120 + i * 40, () => this.scene.tray.fadeOutFood(food))
    })
    // A star per friend + a shared burp; the scene banks a level star + nudges
    // the meter (a duo round is a completed round like any other).
    this.friends.forEach((friend) => {
      const p = this.friendPos(friend.side)
      this.scene.confetti.explode(28, p.x, p.y - this.scene.bodyR * duoScaleForStep(this.step))
      friend.rig.beHappy(900)
    })
    playTone(98, 220, 'sawtooth', 0.09)
    addStars(GAME_ID)
    this.scene.bankDuoRound(this.roundSpitBacks, this.scene.time.now - this.roundStartAt)

    const { next, done } = duoFeedStep(this.step)
    this.step = next

    // Both friends pop bigger together + auras brighten.
    this.scene.time.delayedCall(250, () => {
      this.friends.forEach((friend) => {
        const p = this.friendPos(friend.side)
        friend.rig.duo = { friendIndex: friend.rig.duo!.friendIndex, homeX: p.x, step: this.step }
        this.scene.tweens.add({
          targets: friend.rig.container,
          x: p.x,
          y: p.y,
          scaleX: duoScaleForStep(this.step),
          scaleY: duoScaleForStep(this.step),
          duration: 380,
          ease: 'Back.easeOut',
        })
        this.scene.time.delayedCall(200, () => friend.rig.applyAura(true))
        friend.bubble.destroy()
      })
      ;[523, 659, 784].forEach((f, i) =>
        this.scene.time.delayedCall(300 + i * 120, () => playTone(f, 160, 'triangle', 0.1)),
      )

      if (done) this.scene.time.delayedCall(700, () => this.graduate())
      else this.scene.time.delayedCall(1200, () => this.dealRound())
    })
  }

  /** Both friends blaze to full, walk to the lineup together, then play resumes. */
  private graduate(): void {
    const baseIndex = this.scene.journey.friendsFed
    // Full-size pop + full aura on both.
    this.friends.forEach((friend) => {
      const p = this.friendPos(friend.side)
      this.scene.tweens.add({
        targets: friend.rig.container,
        scaleX: duoScaleForStep(DUO_GROW_STEPS),
        scaleY: duoScaleForStep(DUO_GROW_STEPS),
        duration: 360,
        ease: 'Back.easeOut',
      })
      friend.rig.applyAura(true, DUO_GROW_STEPS)
      this.scene.stars.explode(16, p.x, p.y - this.scene.bodyR * duoScaleForStep(DUO_GROW_STEPS))
    })
    ;[523, 659, 784, 1047].forEach((f, i) =>
      this.scene.time.delayedCall(i * 120, () => playTone(f, 160, 'triangle', 0.1)),
    )

    // Advance the journey by two and see if the episode is complete.
    const { next, outcome } = duoComplete(this.scene.journey)
    const episodeComplete = outcome === 'episode-complete'

    this.scene.time.delayedCall(850, () => {
      // Walk both aside to their lineup slots, shrinking into minis.
      let landed = 0
      this.friends.forEach((friend, i) => {
        const grownIndex = baseIndex + i
        const slot = this.scene.miniSlot(grownIndex)
        this.scene.tweens.add({
          targets: friend.rig.container,
          x: slot.x,
          y: slot.y,
          scaleX: 0.3,
          scaleY: 0.3,
          duration: 700,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            friend.rig.container.destroy()
            const episodeAt = next.episode - (episodeComplete ? 1 : 0)
            const mini = this.scene.stage.spawnMini(grownIndex, episodeAt)
            mini.setScale(0)
            this.scene.tweens.add({
              targets: mini,
              scaleX: 0.3,
              scaleY: 0.3,
              duration: 260,
              ease: 'Back.easeOut',
            })
            if (++landed === this.friends.length) this.finish(next, episodeComplete)
          },
        })
      })
    })
  }

  /** Commit the journey, dismantle the duo, and hand back to solo play. */
  private finish(next: ReturnType<typeof duoComplete>['next'], episodeComplete: boolean): void {
    this.scene.journey = next
    saveData(GAME_ID, journeyToData(this.scene.journey))
    this.active = false
    this.friends = []
    // The left rig instance is reused for the next solo friend; clear its duo
    // override so it reads the live journey again. The top task panel stays
    // hidden until the next solo round's showRequest brings it back with fresh
    // content (no stale-ask flash during the welcome dance).
    this.scene.monsterRig.duo = null

    // Reuse the solo journey stage's welcome dance + hand-off exactly.
    const resume = () => this.scene.resumePlay()
    const danceMs = this.scene.stage.celebrateLineup(episodeComplete)
    this.scene.time.delayedCall(danceMs + 300, () => {
      if (episodeComplete) this.scene.stage.episodeTransition(resume)
      else this.scene.stage.nextFriendEnters(resume)
    })
  }

  // ─── Per-frame + ambient (right rig; the left is the scene's own) ────────────

  /** Live per-friend state for the dev/e2e hook (which mouth wants which food). */
  snapshot(): DuoState {
    return {
      step: this.step,
      sides: this.friends.map((friend) => {
        const world = friend.rig.mouthWorld()
        const entry = friend.request.entries[0]
        return {
          foodId: entry?.foodId ?? '',
          count: entry?.count ?? 0,
          eaten: friend.eaten.length,
          mouthCss: { x: world.x / this.scene.dpr, y: world.y / this.scene.dpr },
        }
      }),
    }
  }

  /** Track the right friend's pupils (the left rig is updated by the scene). */
  update(): void {
    this.rigRight?.update()
  }

  /** Tick the right friend's ambient growth sparkles (left ticks via the scene). */
  tickAura(): void {
    this.rigRight?.tickAura()
  }
}

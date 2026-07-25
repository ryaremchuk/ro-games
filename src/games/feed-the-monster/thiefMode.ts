/**
 * The THIEF on stage — the telegraph, the glide in, the peck window, and the two
 * ways a visit ends. Every decision it acts on comes from thief.ts (pure, tested);
 * this file only performs them.
 *
 * The beat:
 *
 *   telegraph (~1.2 s)      approach        peck window        exit
 *   shadow slides in    →   bird glides  →  1.5–3.0 s      →   flies off
 *   + a distant caw         to a plate      (tap → shoo)        (with or without)
 *
 * The telegraph is MANDATORY. Nothing may ever appear on a plate without warning:
 * at this age an unannounced grab reads as unfair, not exciting.
 *
 * No-fail rules, all of them load-bearing:
 *  1. The thief prefers a distractor, and when it has no choice the replacement
 *     dropped in is guaranteed to be the same food (thief.pickTarget).
 *  2. Stolen food is ALWAYS replaced. The child can never reach a state where the
 *     request cannot be cleared.
 *  3. No visit during a spit-back, a growth pop, a celebration, a transition, a
 *     duo, or while a food is being dragged.
 *  4. Catching pays JOY, not growth or stars — confetti, a squawk, a delighted
 *     friend. Reward framing pulls children away from the thinking task, and the
 *     journey stays tied to care performed.
 *  5. Tapping the butterfly is not punished: it flies away and the friend simply
 *     does not giggle. The reward is withheld, nothing is deducted.
 *
 * Self-contained like duoMode.ts; the scene schedules a visit and delegates.
 */

import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { pickTarget, thiefDials } from './thief'
import type { VisitOutcome, VisitorKind } from './thief'
import { artKey } from './art'
import * as layout from './layout'
import type { VisitorState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

type Phase = 'telegraph' | 'approach' | 'peck' | 'leaving'

/** Wing-flap frame interval while gliding. */
const FLAP_MS = 150
export class ThiefMode {
  /** True from the telegraph until the visitor is off screen. */
  active = false

  private readonly scene: FeedTheMonsterScene
  private kind: VisitorKind = 'thief'
  private phase: Phase = 'telegraph'
  private slot = 0
  private foodId = ''
  private mustReplaceSame = false
  private bird?: Phaser.GameObjects.Image
  private shadow?: Phaser.GameObjects.Ellipse
  private flap?: Phaser.Time.TimerEvent
  private timers: Phaser.Time.TimerEvent[] = []
  private wingUp = true
  private peckEndsAt = 0
  /** Set once the visit has resolved, so a double tap can't score twice. */
  private resolved = false

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  // ─── Start ─────────────────────────────────────────────────────────────────

  /**
   * Begin a visit, if the tray has anything to peck at. Returns false when it
   * cannot start — an empty tray, or one already in flight.
   */
  start(kind: VisitorKind, thiefSkill: number): boolean {
    if (this.active) return false
    const round = this.scene.round
    if (!round) return false

    const candidates = this.scene.tray.foods
      .filter((food) => food !== this.scene.tray.dragged && food.active)
      .map((food) => ({
        slot: food.getData('slot') as number,
        foodId: food.getData('foodId') as string,
        wanted: this.scene.wantsNow(food.getData('foodId') as string),
      }))
    const target = pickTarget(candidates, Math.random)
    if (!target) return false

    this.active = true
    this.resolved = false
    this.kind = kind
    this.phase = 'telegraph'
    this.slot = target.slot
    this.foodId = target.foodId
    this.mustReplaceSame = target.mustReplaceSame

    const dials = thiefDials(thiefSkill)
    const at = layout.slotPos(this.scene.metrics(), this.slot)

    // Telegraph: a shadow slides across the table toward the plate, under a
    // distant caw. This is the part that makes the visit fair.
    this.shadow = this.scene.add
      .ellipse(at.x - this.px(180), at.y + this.px(18), this.px(64), this.px(22), 0x000000, 0.22)
      .setDepth(4)
    this.scene.tweens.add({
      targets: this.shadow,
      x: at.x,
      scaleX: 1.35,
      scaleY: 1.35,
      duration: dials.telegraphMs,
      ease: 'Sine.easeIn',
    })
    if (kind === 'thief') {
      playTone(330, 180, 'sawtooth', 0.05)
      this.after(190, () => playTone(262, 220, 'sawtooth', 0.045))
    } else {
      // The butterfly announces itself softly and high — a different creature
      // before it is even on screen.
      playTone(1047, 120, 'sine', 0.045)
      this.after(150, () => playTone(1319, 140, 'sine', 0.04))
    }

    this.after(dials.telegraphMs, () => this.approach(dials.peckWindowMs))
    return true
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(this.scene.time.delayedCall(ms, fn))
  }

  /** Glide in from off screen and land on the plate. */
  private approach(peckWindowMs: number): void {
    if (!this.active) return
    this.phase = 'approach'
    const at = layout.slotPos(this.scene.metrics(), this.slot)
    const key = this.frameKey()
    this.bird = this.scene.add
      .image(this.scene.scale.width + this.px(120), at.y - this.px(200), key)
      .setDepth(21)
    this.bird.setDisplaySize(this.px(this.kind === 'thief' ? 96 : 78), this.px(78))
    // A generous hit area — at least as big as a food's, plus a margin, because a
    // four-year-old is aiming a finger at something that just moved.
    this.bird.setInteractive({ useHandCursor: true })
    this.bird.on('pointerdown', () => this.onTap())

    this.flap = this.scene.time.addEvent({
      delay: FLAP_MS,
      loop: true,
      callback: () => {
        this.wingUp = !this.wingUp
        if (this.phase !== 'peck') this.bird?.setTexture(this.frameKey())
      },
    })

    this.scene.tweens.add({
      targets: this.bird,
      x: at.x,
      y: at.y - this.px(26),
      duration: 620,
      ease: 'Sine.easeOut',
      onComplete: () => this.land(peckWindowMs),
    })
  }

  /** Landed: the peck loop runs for the window, then the visit resolves. */
  private land(peckWindowMs: number): void {
    if (!this.active || !this.bird) return
    this.phase = 'peck'
    this.peckEndsAt = this.scene.time.now + peckWindowMs
    this.bird.setTexture(this.frameKey())
    this.shadow?.setAlpha(0.3)

    if (this.kind === 'thief') {
      // Peck: a quick bob at the food, over and over.
      this.scene.tweens.add({
        targets: this.bird,
        y: this.bird.y + this.px(14),
        duration: 190,
        yoyo: true,
        repeat: -1,
        ease: 'Quad.easeInOut',
      })
      playTone(880, 50, 'square', 0.04)
    } else {
      // Flutter: wings open and close on the spot, going nowhere, taking nothing.
      this.scene.tweens.add({
        targets: this.bird,
        y: this.bird.y - this.px(10),
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    this.after(peckWindowMs, () => this.lapse())
  }

  private frameKey(): string {
    if (this.kind === 'butterfly') {
      const name = this.wingUp ? 'butterfly-open' : 'butterfly-closed'
      return this.scene.hasArt(name) ? artKey(name) : `ftm-${name}`
    }
    const name =
      this.phase === 'peck' ? 'thief-perch' : this.wingUp ? 'thief-fly-up' : 'thief-fly-down'
    return this.scene.hasArt(name) ? artKey(name) : `ftm-${name}`
  }

  // ─── The two ways it ends ──────────────────────────────────────────────────

  /**
   * The child tapped it. Every tap on a visible visitor counts, including one
   * during the glide in: punishing an eager child for being early is exactly the
   * wrong lesson, and there is nothing to tap during the telegraph anyway, so
   * spam-tapping the sky can never be what pays off.
   */
  private onTap(): void {
    if (!this.active || this.resolved || this.phase === 'leaving') return
    this.resolved = true

    if (this.kind === 'thief') {
      // Shoo: squawk, a puff of feathers, and the friend giggles. Joy only — no
      // growth, no stars.
      playTone(988, 90, 'square', 0.09)
      this.after(70, () => playTone(1319, 110, 'square', 0.07))
      if (this.bird) this.scene.puffs.explode(14, this.bird.x, this.bird.y)
      const mp = this.scene.monsterPos()
      this.scene.confetti.explode(18, mp.x, mp.y - this.scene.bodyR * this.scene.growth)
      if (!this.scene.transitioning) this.scene.monsterRig.beHappy(700)
    } else {
      // Tapping the butterfly is NOT punished. It flies off and the friend simply
      // does not giggle — the reward is withheld, nothing is deducted.
      playTone(523, 130, 'sine', 0.05)
    }
    this.finish({ kind: this.kind, tapped: true })
  }

  /** The window lapsed with no tap. */
  private lapse(): void {
    if (!this.active || this.resolved) return
    this.resolved = true
    if (this.kind === 'butterfly') {
      // It leaves on its own having taken nothing — a correctly-withheld no-go.
      playTone(784, 120, 'sine', 0.04)
      this.finish({ kind: 'butterfly', tapped: false })
      return
    }
    this.steal()
  }

  /** The thief lifts the food and flies off with it — then it is replaced. */
  private steal(): void {
    const stolen = this.scene.tray.foods.find(
      (food) => (food.getData('slot') as number) === this.slot && food.active,
    )
    playTone(196, 200, 'sawtooth', 0.07)
    this.after(140, () => playTone(147, 220, 'sawtooth', 0.06))
    if (!this.scene.transitioning) this.scene.monsterRig.shakeHead()

    if (stolen && stolen !== this.scene.tray.dragged) {
      // Carry it off in the beak: it rides with the bird and leaves the screen.
      this.scene.tray.foods = this.scene.tray.foods.filter((f) => f !== stolen)
      stolen.disableInteractive()
      this.scene.tweens.killTweensOf(stolen)
      const carried = stolen
      this.scene.tweens.add({
        targets: carried,
        x: -this.px(160),
        y: carried.y - this.px(240),
        scaleX: carried.scaleX * 0.7,
        scaleY: carried.scaleY * 0.7,
        duration: 900,
        ease: 'Sine.easeIn',
        onComplete: () => carried.destroy(),
      })
      // Rule 2: ALWAYS replaced. When the thief had no choice but a wanted food,
      // the replacement is the identical food, so the round stays clearable.
      const replacement = this.mustReplaceSame ? this.foodId : this.scene.replacementFood(this.slot)
      this.after(520, () => {
        if (this.scene.transitioning) return
        this.scene.tray.dropReplacement(this.slot, replacement)
        playTone(659, 90, 'sine', 0.06)
      })
    }
    this.finish({ kind: 'thief', tapped: false })
  }

  /** Fly off screen, tell the scene how it went, and tear everything down. */
  private finish(outcome: VisitOutcome): void {
    this.phase = 'leaving'
    for (const timer of this.timers) timer.remove()
    this.timers = []
    const bird = this.bird
    if (bird) {
      this.scene.tweens.killTweensOf(bird)
      bird.disableInteractive()
      this.scene.tweens.add({
        targets: bird,
        x: bird.x + this.px(260),
        y: bird.y - this.px(300),
        angle: 18,
        alpha: 0,
        duration: 640,
        ease: 'Sine.easeIn',
        onComplete: () => bird.destroy(),
      })
    }
    if (this.shadow) {
      const shadow = this.shadow
      this.scene.tweens.killTweensOf(shadow)
      this.scene.tweens.add({
        targets: shadow,
        alpha: 0,
        duration: 400,
        onComplete: () => shadow.destroy(),
      })
    }
    this.flap?.remove()
    this.flap = undefined
    this.bird = undefined
    this.shadow = undefined
    this.active = false
    this.scene.noteVisitOutcome(outcome)
  }

  /** Cancel a visit outright (a celebration or transition took the stage). */
  cancel(): void {
    if (!this.active) return
    this.resolved = true
    for (const timer of this.timers) timer.remove()
    this.timers = []
    this.flap?.remove()
    this.flap = undefined
    if (this.bird) {
      this.scene.tweens.killTweensOf(this.bird)
      this.bird.destroy()
      this.bird = undefined
    }
    if (this.shadow) {
      this.scene.tweens.killTweensOf(this.shadow)
      this.shadow.destroy()
      this.shadow = undefined
    }
    this.active = false
  }

  /** Live visitor state for the dev/e2e hook. */
  snapshotState(): VisitorState | null {
    if (!this.active) return null
    return {
      kind: this.kind,
      phase: this.phase,
      slot: this.slot,
      foodId: this.foodId,
      msLeft: this.phase === 'peck' ? Math.max(0, this.peckEndsAt - this.scene.time.now) : 0,
      xCss: (this.bird?.x ?? 0) / this.scene.dpr,
      yCss: (this.bird?.y ?? 0) / this.scene.dpr,
    }
  }
}

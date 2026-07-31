/**
 * The THIEF on stage — the telegraph, the glide in, the peck window, and the two
 * ways a visit ends. Every decision it acts on comes from thief.ts (pure, tested);
 * this file only performs them.
 *
 * The beat, all of it right-to-left because that is the way the bird flies:
 *
 *   telegraph 1.0–1.5 s    glide 1.24 s      peck window       exit
 *   a distant caw, the  →  the bird flies →  1.5–3.0 s      →  it KEEPS going
 *   stage untouched        in from the       (tap → shoo)      left and up, with
 *                          RIGHT, facing     shadow tight      whatever it took
 *                          left, its own     and dark          in its claws
 *                          shadow under it
 *                          └───────── tappable ────┘
 *
 * The shadow is the BIRD's OWN shadow and it exists only while the bird does: born
 * with it in `approach()`, it hangs on the table line directly under the bird's x,
 * wide and faint while the bird is high, small and dark once it has landed — synced
 * per frame in `update()`, never tweened on a path of its own. (It shipped as an
 * independent tween sliding in from the LEFT while the bird came from the right: a
 * shadow on the wrong side of the plate, attached to nothing.)
 *
 * The telegraph is MANDATORY. Nothing may ever appear on a plate without warning:
 * at this age an unannounced grab reads as unfair, not exciting. It is a SOUND —
 * two descending caws, off stage. It used to also slide a shadow across the table
 * to the plate, and that was a lie the eye caught: a shadow with no bird over it
 * parked next to the food, and then teleported back out to the right edge the
 * instant the real bird entered and `update()` took the shadow over. A bird still
 * off screen and high up casts nothing the child can see; the warning that it is
 * coming is what they hear, and then the 1.24 s glide they watch.
 *
 * The GLIDE is a catch opportunity, not a wait: the visitor carries its full tap
 * circle from its first frame on screen, and it flies slowly enough (thief.APPROACH_MS,
 * doubled after watching the game on the iPad) for a four-year-old to land a finger
 * on it in mid-air.
 *
 * No-fail rules, all of them load-bearing:
 *  1. The thief prefers a distractor, and when it has no choice the replacement
 *     dropped in is guaranteed to be the same food (thief.pickTarget). "Distractor"
 *     means nothing the round still NEEDS — including the parts a kitchen round's
 *     pot is still missing (scene.wantsNow), which is not the same question as
 *     "would the friend eat it".
 *  2. Stolen food is ALWAYS replaced, onto the plate it came from. The child can
 *     never reach a state where the request cannot be cleared.
 *  3. No visit during a spit-back, a growth pop, a celebration, a transition, a
 *     duo, a belt or a KITCHEN round, or while a food is being dragged. (The gate
 *     lives in FeedTheMonsterScene.scheduleVisit; the dev force bypasses it, so
 *     rules 1 and 2 still have to hold on a kitchen round.)
 *  4. Catching pays JOY, not growth or stars — confetti, a squawk, a delighted
 *     friend. Reward framing pulls children away from the thinking task, and the
 *     journey stays tied to care performed.
 *  5. What the bird takes, the child can SEE it take: the stolen food rides in its
 *     claws from the grab until it is off screen, so the theft is one legible
 *     event and not a food vanishing sideways.
 *
 * Self-contained like duoMode.ts; the scene schedules a visit and delegates.
 */

import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { pickTarget, thiefDials } from './thief'
import type { ThiefDials, VisitOutcome } from './thief'
import * as layout from './layout'
import type { VisitorState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

type Phase = 'telegraph' | 'approach' | 'peck' | 'leaving'

/** Wing-flap frame interval while gliding. */
const FLAP_MS = 150
/** How far off screen (right) and above the plate the glide starts, in CSS px. */
const ENTRY_X_CSS = 120
const ENTRY_RISE_CSS = 200
/** Where the visitor settles, above the plate it is after. */
const PERCH_RISE_CSS = 26
/**
 * The exit: it carries ON the way it came (left) and climbs. Reversing into a
 * right-hand exit was the old behaviour and it read as two different birds — and it
 * pulled away from the stolen food, which was leaving to the left.
 *
 * The target is OFF SCREEN, a bird's width past the left edge, not a fixed nudge:
 * the food has to stay in the claws until the bird is gone, and a fixed −340 css
 * left a bird that stole from a right-hand plate hanging in mid-air, where it (and
 * the food) simply blinked out. The rise is fixed — it only has to clear the table.
 */
const EXIT_CLEAR_CSS = 160
const EXIT_RISE_CSS = 300
/**
 * Getaway speed in CSS px per second, so the flight is the same physical speed
 * wherever the bird takes off from and on every device — a fixed duration would
 * make an escape from the far plate a rocket and one from the near plate a crawl.
 *
 * Deliberately unhurried (~1 s to cross an iPad's half-width): the theft only
 * teaches "watch for the bird" if the child SEES the food leave in its claws, and
 * nothing is blocked while it flies — the round stays playable through the exit.
 */
const EXIT_SPEED_CSS = 600

/** The shadow ellipse at ground level, in CSS px (scaled by altitude below). */
const SHADOW_W_CSS = 64
const SHADOW_H_CSS = 22
/** The table line: a touch below the plate the bird is after, in CSS px. */
const SHADOW_DROP_CSS = 18
/**
 * Altitude that reads as "as high as this bird ever gets", in CSS px — the exit
 * top (PERCH_RISE + EXIT_RISE + the drop). The shadow's size and alpha ride the
 * bird's height above the table between 0 and this.
 */
const SHADOW_MAX_RISE_CSS = 344
/** Landed: a tight, dark shadow. High: a wide, faint one. */
const SHADOW_SCALE_LOW = 0.9
const SHADOW_SCALE_HIGH = 1.9
const SHADOW_ALPHA_LOW = 0.34
const SHADOW_ALPHA_HIGH = 0.05

/**
 * Where the claws are, as an offset from the bird's centre in CSS px — MEASURED
 * off the shipped sprites (`art/thief-*.png`), by finding each frame's orange
 * foot pixels and taking their centroid at display size. All three frames agree
 * to within ~2 px vertically because they share one body anchor, which is why a
 * single pair of constants can serve the flap pair and the perch alike.
 *
 * The procedural fallback (textures.ts) hangs its legs a few px lower and further
 * back, so without art the food rides slightly high on the belly — harmless on a
 * path that only runs before the sprites load.
 */
const CLAW_DX_CSS = 2
const CLAW_DY_CSS = 36
/** A food held up in the air reads slightly smaller than one on a plate. */
const CARRIED_SCALE = 0.8

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export class ThiefMode {
  /** True from the telegraph until the bird is off screen. */
  active = false

  private readonly scene: FeedTheMonsterScene
  private phase: Phase = 'telegraph'
  private slot = 0
  private foodId = ''
  private mustReplaceSame = false
  private bird?: Phaser.GameObjects.Image
  private shadow?: Phaser.GameObjects.Ellipse
  /** The stolen food, riding in the claws until the bird is gone. */
  private carried?: Phaser.GameObjects.Image
  private flap?: Phaser.Time.TimerEvent
  private timers: Phaser.Time.TimerEvent[] = []
  /**
   * The stolen food's replacement. Kept OFF `timers` on purpose — see steal().
   */
  private replacementTimer?: Phaser.Time.TimerEvent
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
  start(thiefSkill: number): boolean {
    if (this.active) return false
    const round = this.scene.round
    if (!round) return false

    const candidates = this.scene.tray.foods
      // Only food that lives ON A PLATE. `tray.foods` also carries food that has no
      // plate to go back to — the cooked dish sitting on the pot reports slot −1 —
      // and stealing one of those would ask `layout.slotPos` for a plate that does
      // not exist and then drop the replacement onto it. Rule 2 (always replaced)
      // can only be honoured for a real slot.
      .filter(
        (food) =>
          food !== this.scene.tray.dragged && food.active && (food.getData('slot') as number) >= 0,
      )
      .map((food) => ({
        slot: food.getData('slot') as number,
        foodId: food.getData('foodId') as string,
        wanted: this.scene.wantsNow(food.getData('foodId') as string),
      }))
    const target = pickTarget(candidates, Math.random)
    if (!target) return false

    this.active = true
    this.resolved = false
    this.phase = 'telegraph'
    this.slot = target.slot
    this.foodId = target.foodId
    this.mustReplaceSame = target.mustReplaceSame

    const dials = thiefDials(thiefSkill)

    // Telegraph: two descending caws from off stage, and nothing drawn — the bird
    // is still off screen and high, so it casts no shadow the child could see. The
    // sound is the whole warning, and it is what makes the visit fair.
    playTone(330, 180, 'sawtooth', 0.05)
    this.after(190, () => playTone(262, 220, 'sawtooth', 0.045))

    this.after(dials.telegraphMs, () => this.approach(dials))
    return true
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(this.scene.time.delayedCall(ms, fn))
  }

  /** Glide in from off screen right and land on the plate. */
  private approach(dials: ThiefDials): void {
    if (!this.active) return
    this.phase = 'approach'
    const at = layout.slotPos(this.scene.metrics(), this.slot)
    const key = this.frameKey()
    this.bird = this.scene.add
      .image(this.scene.scale.width + this.px(ENTRY_X_CSS), at.y - this.px(ENTRY_RISE_CSS), key)
      // The art faces RIGHT (the beak is at +bodyR, textures.ts), and the bird
      // flies right → left, so it must be mirrored or it arrives tail-first.
      .setFlipX(true)
      .setDepth(21)
    // Sized AND made tappable before the first frame is drawn: the tap counts from
    // the moment the bird exists, so it must never be on screen without its circle.
    this.fitVisitor()
    this.bird.on('pointerdown', () => this.onTap())
    // The bird's shadow, created WITH the bird and owned by `update()` from its
    // first frame: it enters with the high-altitude look (wide, faint) and is
    // immediately re-derived from the bird's real height, so it can never be seen
    // anywhere the bird is not.
    this.shadow = this.scene.add
      .ellipse(
        this.bird.x,
        at.y + this.px(SHADOW_DROP_CSS),
        this.px(SHADOW_W_CSS),
        this.px(SHADOW_H_CSS),
        0x000000,
      )
      .setDepth(4)
      .setScale(SHADOW_SCALE_HIGH)
      .setAlpha(SHADOW_ALPHA_HIGH)
    this.update()

    this.flap = this.scene.time.addEvent({
      delay: FLAP_MS,
      loop: true,
      callback: () => {
        this.wingUp = !this.wingUp
        if (this.phase !== 'peck') {
          this.bird?.setTexture(this.frameKey())
          this.fitVisitor()
        }
      },
    })

    this.scene.tweens.add({
      targets: this.bird,
      x: at.x,
      y: at.y - this.px(PERCH_RISE_CSS),
      // Half the speed it shipped at — the glide is the child's chance to catch the
      // bird in mid-air, and it lives in thief.ts because it is a design dial.
      duration: dials.approachMs,
      ease: 'Sine.easeOut',
      onComplete: () => this.land(dials.peckWindowMs),
    })
  }

  /**
   * Size the visitor and give it its tap circle, both derived from the CURRENT
   * frame — so swapping wing-up ↔ wing-down ↔ perch can never shrink either, even
   * if a future art frame arrives at a different resolution.
   *
   * The circle lives in unscaled frame coords (like a tray food's), hence the
   * divide by the sprite's own scale: what the finger gets is a
   * `layout.visitorTapRadius` circle of glass whatever the art's resolution. It is
   * assigned in place because Phaser's `setInteractive` ignores a new shape once an
   * object is already interactive (InputPlugin.enable only flips `enabled`).
   */
  private fitVisitor(): void {
    const bird = this.bird
    if (!bird) return
    bird.setDisplaySize(this.px(layout.VISITOR_W_CSS), this.px(layout.VISITOR_H_CSS))
    const shape = new Phaser.Geom.Circle(
      bird.frame.width / 2,
      bird.frame.height / 2,
      this.tapRadius() / Math.min(bird.scaleX, bird.scaleY),
    )
    if (bird.input) {
      bird.input.hitArea = shape
      bird.input.hitAreaCallback = Phaser.Geom.Circle.Contains
    } else {
      bird.setInteractive({
        hitArea: shape,
        hitAreaCallback: Phaser.Geom.Circle.Contains,
        useHandCursor: true,
      })
    }
  }

  /** On-glass tap radius for the visitor, in backing px. */
  private tapRadius(): number {
    return layout.visitorTapRadius(this.scene.metrics())
  }

  // ─── Per frame: what hangs off the bird ─────────────────────────────────────

  /**
   * Pin the bird's shadow and whatever it is carrying to the bird, every frame.
   *
   * Both used to be independent tweens, and both drifted away from the bird they
   * belong to: the shadow slid in from the opposite side, and the stolen food flew
   * off in the opposite direction. Anything that is *part of* the bird is derived
   * from the bird's live position instead — there is nothing left to diverge.
   *
   * Called by FeedTheMonsterScene.update while `active`.
   */
  update(): void {
    const groundY = layout.slotPos(this.scene.metrics(), this.slot).y + this.px(SHADOW_DROP_CSS)
    const bird = this.bird
    if (this.shadow && bird) {
      // Altitude, not phase: the same rule reads for a bird gliding in, perched, or
      // climbing away — higher is bigger and fainter, landed is tight and dark.
      const t = Phaser.Math.Clamp((groundY - bird.y) / this.px(SHADOW_MAX_RISE_CSS), 0, 1)
      this.shadow.setPosition(bird.x, groundY)
      this.shadow.setScale(lerp(SHADOW_SCALE_LOW, SHADOW_SCALE_HIGH, t))
      this.shadow.setAlpha(lerp(SHADOW_ALPHA_LOW, SHADOW_ALPHA_HIGH, t))
    }
    if (this.carried && bird) {
      // Mirrored with the bird: the claw offset is measured on art that faces right.
      const dx = this.px(CLAW_DX_CSS) * (bird.flipX ? -1 : 1)
      this.carried.setPosition(bird.x + dx, bird.y + this.px(CLAW_DY_CSS))
    }
  }

  /** Landed: the peck loop runs for the window, then the visit resolves. */
  private land(peckWindowMs: number): void {
    if (!this.active || !this.bird) return
    this.phase = 'peck'
    this.peckEndsAt = this.scene.time.now + peckWindowMs
    this.bird.setTexture(this.frameKey())
    this.fitVisitor()

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

    this.after(peckWindowMs, () => this.lapse())
  }

  private frameKey(): string {
    const name =
      this.phase === 'peck' ? 'thief-perch' : this.wingUp ? 'thief-fly-up' : 'thief-fly-down'
    return this.scene.look(name, `ftm-${name}`)
  }

  // ─── The two ways it ends ──────────────────────────────────────────────────

  /**
   * The child tapped it. Every tap on a visible bird counts, including one during
   * the glide in — with the same consequences as a perched tap: punishing an eager
   * child for being early is exactly the wrong lesson, and there is nothing to tap
   * during the telegraph anyway, so spam-tapping the sky can never be what pays
   * off. The glide is deliberately slow enough (thief.APPROACH_MS) for that
   * mid-air catch to be a real option and not a fluke.
   */
  private onTap(): void {
    if (!this.active || this.resolved || this.phase === 'leaving') return
    this.resolved = true

    // Shoo: squawk, a puff of feathers, and the friend giggles. Joy only — no
    // growth, no stars.
    playTone(988, 90, 'square', 0.09)
    this.after(70, () => playTone(1319, 110, 'square', 0.07))
    if (this.bird) this.scene.puffs.explode(14, this.bird.x, this.bird.y)
    const mp = this.scene.monsterPos()
    this.scene.confetti.explode(18, mp.x, mp.y - this.scene.bodyR * this.scene.growth)
    if (!this.scene.transitioning) this.scene.monsterRig.beHappy(700)
    this.finish({ tapped: true })
  }

  /** The window lapsed with no tap. */
  private lapse(): void {
    if (!this.active || this.resolved) return
    this.resolved = true
    this.steal()
  }

  /** The thief lifts the food into its claws and flies off — then it is replaced. */
  private steal(): void {
    const stolen = this.scene.tray.foods.find(
      (food) => (food.getData('slot') as number) === this.slot && food.active,
    )
    playTone(196, 200, 'sawtooth', 0.07)
    this.after(140, () => playTone(147, 220, 'sawtooth', 0.06))
    if (!this.scene.transitioning) this.scene.monsterRig.shakeHead()

    if (stolen && stolen !== this.scene.tray.dragged) {
      // Into the claws: from here it is part of the bird (see update()), so it
      // leaves the screen with it instead of on a path of its own.
      this.scene.tray.foods = this.scene.tray.foods.filter((f) => f !== stolen)
      stolen.disableInteractive()
      this.scene.tweens.killTweensOf(stolen)
      stolen.setDepth(22).setScale(stolen.scaleX * CARRIED_SCALE, stolen.scaleY * CARRIED_SCALE)
      this.carried = stolen
      // Rule 2: ALWAYS replaced. When the thief had no choice but a wanted food,
      // the replacement is the identical food, so the round stays clearable.
      //
      // Deliberately NOT on `this.timers`: those are the VISIT's own beats and
      // `finish()` — which runs on the very next line — clears them. The
      // replacement has to outlive the bird, or a theft leaves a permanently
      // empty plate. Only `cancel()` (the round ended) may call it off.
      const replacement = this.mustReplaceSame ? this.foodId : this.scene.replacementFood(this.slot)
      this.replacementTimer?.remove()
      this.replacementTimer = this.scene.time.delayedCall(520, () => {
        this.replacementTimer = undefined
        if (this.scene.transitioning) return
        this.scene.tray.dropReplacement(this.slot, replacement)
        playTone(659, 90, 'sine', 0.06)
      })
    }
    this.finish({ tapped: false })
  }

  /**
   * Fly off screen and tell the scene how it went. The bird CONTINUES the way it
   * came — left and up — so the shadow under it and the food in its claws ride out
   * with it (they are synced to it, not tweened). `active` stays true until it is
   * gone, which is what makes that ride observable.
   */
  private finish(outcome: VisitOutcome): void {
    this.phase = 'leaving'
    for (const timer of this.timers) timer.remove()
    this.timers = []
    this.flap?.remove()
    this.flap = undefined
    this.scene.noteVisitOutcome(outcome)

    const bird = this.bird
    if (!bird) {
      this.teardown()
      return
    }
    this.scene.tweens.killTweensOf(bird)
    bird.disableInteractive()
    this.update()
    // Off the left edge, at a constant physical speed: it must be GONE before it is
    // destroyed, or the food in its claws vanishes in plain sight.
    const exitX = -this.px(EXIT_CLEAR_CSS)
    const duration = Math.max(240, ((bird.x - exitX) / this.px(EXIT_SPEED_CSS)) * 1000)
    this.scene.tweens.add({
      targets: bird,
      x: exitX,
      y: bird.y - this.px(EXIT_RISE_CSS),
      // Nose up while facing left (the sprite is mirrored) — a climbing getaway.
      angle: 18,
      duration,
      ease: 'Sine.easeIn',
      onComplete: () => this.teardown(),
    })
  }

  /** The bird is gone: drop everything that hung off it. */
  private teardown(): void {
    this.bird?.destroy()
    this.bird = undefined
    this.shadow?.destroy()
    this.shadow = undefined
    this.carried?.destroy()
    this.carried = undefined
    this.active = false
  }

  /** Cancel a visit outright (a celebration or transition took the stage). */
  cancel(): void {
    if (!this.active) return
    this.resolved = true
    for (const timer of this.timers) timer.remove()
    this.timers = []
    // A cancelled visit is the ONE case where the replacement is dropped too: the
    // round is over, so there is no plate left to refill.
    this.replacementTimer?.remove()
    this.replacementTimer = undefined
    this.flap?.remove()
    this.flap = undefined
    for (const object of [this.bird, this.shadow, this.carried]) {
      if (object) this.scene.tweens.killTweensOf(object)
    }
    // Including the food in the claws: a round that ends mid-flight must not leave
    // a stolen food hanging in the air with no bird under it.
    this.teardown()
  }

  /** Live visitor state for the dev/e2e hook. */
  snapshotState(): VisitorState | null {
    if (!this.active) return null
    const dpr = this.scene.dpr
    return {
      phase: this.phase,
      slot: this.slot,
      foodId: this.foodId,
      msLeft: this.phase === 'peck' ? Math.max(0, this.peckEndsAt - this.scene.time.now) : 0,
      xCss: (this.bird?.x ?? 0) / dpr,
      yCss: (this.bird?.y ?? 0) / dpr,
      tapRadiusCss: this.tapRadius() / dpr,
      shadow: this.shadow ? { xCss: this.shadow.x / dpr, yCss: this.shadow.y / dpr } : null,
      carried: this.carried ? { xCss: this.carried.x / dpr, yCss: this.carried.y / dpr } : null,
    }
  }
}

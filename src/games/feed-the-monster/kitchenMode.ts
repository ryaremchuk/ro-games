/**
 * The KITCHEN — the pot, and the round where the child COOKS what the friend
 * wants instead of finding it.
 *
 * The beat: the bubble shows the finished dish large with its parts in a row
 * underneath; a pot stands on the table; each correct part dropped in drops with a
 * puff of steam and ghosts its picture in the bubble (the exact ghosting language
 * count rounds already use); the last part in rattles the lid and the finished
 * dish POPS OUT, draggable; feeding it completes the round normally.
 *
 * Two things keep the round honest rather than merely long:
 *  • The pot spits a wrong part back with the same arc-home motion and "blegh"
 *    beat as the friend's spit-back. Consistency matters more than novelty — the
 *    child already knows what that means.
 *  • The friend refuses raw ingredients (logic.wantsFood accepts only the cooked
 *    dish), so there is exactly one right thing to do at every moment. The obvious
 *    failure mode for this feature is a 4-year-old reading the recipe as "feed
 *    these three things to the friend" and skipping the pot entirely.
 *
 * Same self-contained shape as duoMode.ts: the scene delegates to it and it owns
 * its own display objects, reusing the tray for the made dish so the drag, the
 * snap assist and the feed handoff are the shared ones.
 */

import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { dishResult, isDishCooked, potAccepts, potWants } from './logic'
import type { DishRequest } from './logic'
import { recipeById } from './recipes'
import { artKey } from './art'
import * as layout from './layout'
import type { KitchenState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

/** Slot index the made dish reports as its home (it lives on the pot, not a plate). */
const MADE_DISH_SLOT = -1

export class KitchenMode {
  /** True while a kitchen round is on stage. */
  active = false

  private readonly scene: FeedTheMonsterScene
  private request: DishRequest | null = null
  private pot?: Phaser.GameObjects.Image
  private potGlow?: Phaser.GameObjects.Image
  private glowPulse?: Phaser.Tweens.Tween
  /** Parts already in the pot, in the order they went in. */
  private contents: string[] = []
  /** The cooked dish sitting on the pot, waiting to be fed. */
  private made: Phaser.GameObjects.Image | null = null

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  get potContents(): readonly string[] {
    return this.contents
  }

  get madeDishId(): string | null {
    return this.made ? (this.made.getData('foodId') as string) : null
  }

  // ─── Start / stop ──────────────────────────────────────────────────────────

  /** Stand the pot up for a kitchen round. */
  start(request: DishRequest): void {
    this.stop()
    this.active = true
    this.request = request
    this.contents = []

    const m = this.scene.metrics()
    const at = layout.potPos(m)
    const w = layout.potWidth(m)

    // A soft pool of light under the pot. During a kitchen round the pot has to be
    // visually LOUDER than the friend's mouth, or the child feeds the parts to the
    // friend and never discovers the pot at all.
    this.potGlow = this.scene.add
      .image(at.x, at.y + this.px(6), 'ftm-halo')
      .setDisplaySize(w * 1.9, w * 1.5)
      .setDepth(3)
      .setTint(0xffc233)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.5)
    this.glowPulse = this.scene.tweens.add({
      targets: this.potGlow,
      alpha: { from: 0.4, to: 0.85 },
      duration: 720,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    const key = this.scene.hasArt('pot') ? artKey('pot') : 'ftm-pot'
    this.pot = this.scene.add.image(at.x, at.y, key).setDepth(4)
    this.pot.setDisplaySize(w, w * 0.8)
    this.pot.setTint(this.scene.episode.palette.tableEdge)
    // Pop in from nothing to the display size setDisplaySize just resolved.
    const sx = this.pot.scaleX
    const sy = this.pot.scaleY
    this.pot.setScale(0)
    this.scene.tweens.add({
      targets: this.pot,
      scaleX: sx,
      scaleY: sy,
      duration: 420,
      ease: 'Back.easeOut',
    })
    playTone(392, 110, 'triangle', 0.08)
    this.scene.time.delayedCall(130, () => playTone(523, 130, 'triangle', 0.08))
  }

  stop(): void {
    this.active = false
    this.request = null
    this.contents = []
    this.glowPulse?.remove()
    this.glowPulse = undefined
    if (this.potGlow) {
      this.scene.tweens.killTweensOf(this.potGlow)
      this.potGlow.destroy()
      this.potGlow = undefined
    }
    if (this.pot) {
      this.scene.tweens.killTweensOf(this.pot)
      this.pot.destroy()
      this.pot = undefined
    }
    if (this.made) {
      this.scene.tray.removeFood(this.made)
      this.made = null
    }
  }

  /** Re-anchor the pot after a resize / orientation change. */
  place(): void {
    if (!this.active || !this.pot) return
    const m = this.scene.metrics()
    const at = layout.potPos(m)
    const w = layout.potWidth(m)
    this.pot.setPosition(at.x, at.y).setDisplaySize(w, w * 0.8)
    this.potGlow?.setPosition(at.x, at.y + this.px(6)).setDisplaySize(w * 1.9, w * 1.5)
    if (this.made) this.made.setPosition(at.x, this.madeDishY())
  }

  private madeDishY(): number {
    return layout.potPos(this.scene.metrics()).y - layout.potWidth(this.scene.metrics()) * 0.5
  }

  // ─── The pot as a drop target ──────────────────────────────────────────────

  /**
   * The pot's drop target, shaped like a feed mouth so the tray's existing drag
   * routing (nearest target, magnetic assist, drop handoff) needs no new concept.
   * `isOpen`/`setOpen` are no-ops: a pot does not open, it just receives.
   */
  dropTarget(): {
    x: number
    y: number
    snap: number
    isOpen: () => number
    setOpen: (target: number, ms: number) => void
    accept: (img: Phaser.GameObjects.Image) => void
  } | null {
    if (!this.active || !this.pot) return null
    const m = this.scene.metrics()
    const at = layout.potPos(m)
    return {
      x: at.x,
      y: at.y,
      snap: layout.potSnapRadius(m),
      isOpen: () => 0,
      setOpen: () => {},
      accept: (img) => this.drop(img),
    }
  }

  /** A food was released over the pot. */
  private drop(img: Phaser.GameObjects.Image): void {
    const request = this.request
    if (!request) return
    const foodId = img.getData('foodId') as string
    // The made dish belongs to the friend, not back in the pot.
    if (img === this.made) {
      this.returnMade()
      return
    }
    if (!potAccepts(request, this.contents, foodId)) {
      this.rejectPart(img)
      return
    }
    this.acceptPart(img, foodId, request)
  }

  private acceptPart(img: Phaser.GameObjects.Image, foodId: string, request: DishRequest): void {
    const at = layout.potPos(this.scene.metrics())
    img.disableInteractive()
    this.scene.tweens.killTweensOf(img)
    const base = this.scene.tray.foodBaseScale(img)
    // Drop in: the part sinks into the pot and shrinks out of sight.
    this.scene.tweens.add({
      targets: img,
      x: at.x,
      y: at.y + this.px(6),
      scaleX: base * 0.25,
      scaleY: base * 0.25,
      duration: 240,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.scene.tray.removeFood(img)
        // Steam, on the emitter the game already owns.
        this.scene.puffs.explode(10, at.x, at.y - this.px(10))
      },
    })
    playTone(523, 80, 'sine', 0.07)
    this.scene.time.delayedCall(90, () => playTone(659, 90, 'sine', 0.06))

    const index = this.contents.length
    this.contents.push(foodId)
    // The matching picture in the bubble ghosts out — the same language counts use.
    this.scene.bubbleUi.markDishPart(index)
    this.bumpPot(1.08)

    if (isDishCooked(request, this.contents)) {
      this.scene.time.delayedCall(320, () => this.cook(request))
    } else if (request.ordered) {
      // Ordered rounds pulse the next-needed slot so "which one now" is answered
      // without words.
      this.scene.bubbleUi.pulseDishPart(this.contents.length)
    }
  }

  /** A wrong part: the pot spits it back, same beat as the friend's spit-back. */
  private rejectPart(img: Phaser.GameObjects.Image): void {
    this.scene.notePotReject()
    playTone(220, 200, 'sine', 0.07)
    this.scene.time.delayedCall(110, () => playTone(165, 170, 'sine', 0.06))
    const at = layout.potPos(this.scene.metrics())
    this.scene.puffs.explode(6, at.x, at.y - this.px(6))
    this.bumpPot(0.94)
    const home = this.scene.tray.homePos(img)
    const base = this.scene.tray.foodBaseScale(img)
    img.disableInteractive()
    this.scene.tray.arcTo(img, home.x, home.y, 520, () => {
      img.setInteractive()
      if (this.scene.transitioning) this.scene.tray.fadeOutFood(img)
    })
    this.scene.tweens.add({
      targets: img,
      scaleX: base,
      scaleY: base,
      duration: 380,
      ease: 'Quad.easeOut',
    })
    // In an ordered round, say which one WAS wanted rather than just refusing.
    if (this.request?.ordered) this.scene.bubbleUi.pulseDishPart(this.contents.length)
  }

  private bumpPot(by: number): void {
    if (!this.pot) return
    const sx = this.pot.scaleX
    const sy = this.pot.scaleY
    this.scene.tweens.killTweensOf(this.pot)
    this.scene.tweens.add({
      targets: this.pot,
      scaleX: sx * by,
      scaleY: sy * (2 - by),
      duration: 130,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => this.pot?.setScale(sx, sy),
    })
  }

  // ─── Cook ──────────────────────────────────────────────────────────────────

  /** The last part is in: rattle, steam burst, and the dish pops out on top. */
  private cook(request: DishRequest): void {
    if (!this.active || !this.pot) return
    const at = layout.potPos(this.scene.metrics())
    // Lid rattle, done as a wobble on the pot itself (no lid sprite needed).
    const sx = this.pot.scaleX
    const sy = this.pot.scaleY
    this.scene.tweens.add({
      targets: this.pot,
      angle: { from: -5, to: 5 },
      duration: 90,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.pot?.setAngle(0),
    })
    for (let i = 0; i < 3; i++) {
      this.scene.time.delayedCall(i * 130, () => {
        this.scene.puffs.explode(8, at.x + this.px(i * 8 - 8), at.y - this.px(14))
        playTone(392 + i * 90, 70, 'sine', 0.05)
      })
    }

    this.scene.time.delayedCall(430, () => {
      if (!this.active || !this.pot) return
      this.scene.puffs.explode(22, at.x, at.y - this.px(16))
      this.scene.stars.explode(10, at.x, at.y - this.px(20))
      ;[659, 880, 1047].forEach((freq, i) =>
        this.scene.time.delayedCall(i * 110, () => playTone(freq, 160, 'triangle', 0.1)),
      )
      this.pot.setScale(sx, sy)

      // The finished dish pops out of the pot and sits on top, draggable — the
      // child feeds it, which keeps the game's core verb intact.
      const foodId = dishResult(request)
      const dish = this.scene.tray.makeFood(foodId, at.x, at.y, MADE_DISH_SLOT)
      dish.setDepth(6)
      this.made = dish
      const base = this.scene.tray.foodBaseScale(dish)
      dish.setScale(base * 0.3)
      this.scene.tweens.add({
        targets: dish,
        y: this.madeDishY(),
        scaleX: base * 1.15,
        scaleY: base * 1.15,
        duration: 420,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({
            targets: dish,
            scaleX: base,
            scaleY: base,
            duration: 200,
            ease: 'Quad.easeOut',
          })
          // A slow bob so it reads as "take me".
          this.scene.tweens.add({
            targets: dish,
            y: this.madeDishY() - this.px(9),
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          })
        },
      })
    })
  }

  /** The made dish, dropped anywhere but the mouth, arcs back onto the pot. */
  private returnMade(): void {
    const dish = this.made
    if (!dish) return
    const base = this.scene.tray.foodBaseScale(dish)
    dish.disableInteractive()
    this.scene.tray.arcTo(
      dish,
      layout.potPos(this.scene.metrics()).x,
      this.madeDishY(),
      420,
      () => {
        dish.setInteractive()
        dish.setDepth(6)
      },
    )
    this.scene.tweens.add({
      targets: dish,
      scaleX: base,
      scaleY: base,
      duration: 360,
      ease: 'Quad.easeOut',
    })
  }

  /** The made dish was eaten — it is gone, and so is the pot's job. */
  noteEaten(img: Phaser.GameObjects.Image): void {
    if (img !== this.made) return
    this.made = null
    this.glowPulse?.remove()
    this.glowPulse = undefined
    if (this.potGlow) this.scene.tweens.add({ targets: this.potGlow, alpha: 0, duration: 260 })
  }

  /** Is a food currently the cooked dish (so the mouth should accept it)? */
  isMade(img: Phaser.GameObjects.Image): boolean {
    return img === this.made
  }

  /** Live kitchen state for the dev/e2e hook. */
  snapshotState(): KitchenState {
    const m = this.scene.metrics()
    const at = layout.potPos(m)
    return {
      recipeId: this.request?.recipeId ?? '',
      ordered: this.request?.ordered ?? false,
      ingredients: this.request ? [...recipeById(this.request.recipeId).ingredients] : [],
      contents: [...this.contents],
      wants: this.request ? potWants(this.request, this.contents) : [],
      madeDish: this.madeDishId,
      potCss: { x: at.x / this.scene.dpr, y: at.y / this.scene.dpr },
      snapCss: layout.potSnapRadius(m) / this.scene.dpr,
    }
  }
}

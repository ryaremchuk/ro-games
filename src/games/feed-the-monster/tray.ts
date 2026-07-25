/**
 * The food TRAY — the row of plates and the draggable food sprites that sit on
 * them. Owns the plates, the foods, and the currently-dragged food, plus their
 * build/layout/animation (the drop-in bounce, the tap wiggle, the arc back to a
 * plate, the fade-out) and the drag mechanics (make each food draggable; on a
 * drop over the mouth, hand off to the scene to feed; else arc it home).
 *
 * Factored out of the scene so all of the tray's build/animate/drag logic lives
 * in one widget. The scene constructs one (`new Tray(this)`) and delegates; the
 * tray holds its own display objects and reads live scene state (dpr / episode /
 * transitioning / monsterRig / metrics) plus hasArt/feed back through the passed
 * scene reference. The round STATE machine (feed/swallow/eatCorrect/spitBack/
 * completeRound/startRound) stays on the scene and calls into the tray.
 */
import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { TRAY_SIZE } from './logic'
import { BIG_BITE_FOOD_BOOST } from './journey'
import { artKey } from './art'
import * as layout from './layout'
import * as textures from './textures'
import type { FeedMouth } from './duoMode'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

// Mirrors the scene's FOOD_CSS: reskin sprites are normalized to this emoji
// footprint, so it must match the scene's value exactly (see journeyStage.ts for
// the same duplicate-to-avoid-a-value-import pattern).
const FOOD_CSS = 64

// Big-bite tray dressing. The glow is the growth-aura gradient texture reused at
// tray scale — a warm pool of light under each slot — and the plate itself takes
// a gold wash, so the whole row reads as "special" at a glance.
// A deep amber under an ADDITIVE blend: the episode palettes run pale (peach,
// cream, mint, pink), and a normally-blended gold on pale scenery just tints the
// table a slightly warmer shade of itself. Added light instead BRIGHTENS toward
// white-gold, which reads as a lamp switched on under each plate on every theme.
const GLOW_TINT = 0xffa023
const PLATE_BIG_BITE_TINT = 0xffd166
// Halo footprint as a multiple of the slot's plate width. Kept tight to the
// plate: eight wide halos bleed into one another and just repaint the whole
// table band (which the scenery already is), where eight tight ones read as
// what they are — every plate individually lit up.
const GLOW_W_MUL = 1.25
const GLOW_H_MUL = 1.25
// The shimmer travels left→right across the row: one shared pulse tween whose
// per-glow delay steps by this much, so the eye is pulled down to the tray.
const GLOW_STAGGER_MS = 45
const GLOW_ALPHA_LOW = 0.55
const GLOW_ALPHA_HIGH = 1

export class Tray {
  /** The plate sprites (the scene's layout() re-anchors + reskins them). */
  plates: Phaser.GameObjects.Image[] = []
  /**
   * One soft golden halo per slot, behind the plates — the big-bite round's
   * PERSISTENT signal (the friend's lip-smack announces the round, these keep
   * saying it while it is played). Alpha 0 in a normal round.
   */
  private glows: Phaser.GameObjects.Image[] = []
  /** The travelling shimmer across the glows; killed when the round ends. */
  private glowPulse?: Phaser.Tweens.Tween
  /** Is the current round a big bite? (drives the glows + the food boost) */
  private bigBite = false
  /**
   * The draggable food sprites currently on the tray. Public so the scene's
   * layout() re-anchors them, the e2e state hook maps their coords, and the
   * feed loop (eatCorrect/spitBack/completeRound) reads/mutates the list.
   */
  foods: Phaser.GameObjects.Image[] = []
  /**
   * The food being dragged right now (null when idle). Public so the scene's
   * layout()/completeRound skip it and MonsterRig.update() tracks it.
   */
  dragged: Phaser.GameObjects.Image | null = null

  private readonly scene: FeedTheMonsterScene

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  /**
   * Texture for a food: reskin sprite when shipped, emoji strike otherwise.
   * Public — RequestBubble fills its tiles/slots with the same textures.
   */
  foodTexture(foodId: string): string {
    return this.scene.hasArt(`food-${foodId}`) ? artKey(`food-${foodId}`) : `ftm-food-${foodId}`
  }

  /**
   * A tray food's resting scale (1 for emoji textures; reskin sprites are
   * normalized down from atlas resolution), times the big-bite boost when one
   * is on. All food scale tweens are multiples of this, so every motion the
   * tray owns (drop-in, drag lift, arc home, layout re-anchor) picks up a
   * boost change for free. Public — the scene's layout()/feed/spit-back reuse it.
   */
  foodBaseScale(img: Phaser.GameObjects.Image): number {
    return ((img.getData('baseScale') as number | undefined) ?? 1) * this.foodBoost
  }

  /**
   * The scale multiplier on every tray food right now: 1 normally,
   * BIG_BITE_FOOD_BOOST while a big-bite round is dressed. Public so the e2e
   * hook can assert the visual layer actually went up, not just the flag.
   */
  get foodBoost(): number {
    return this.bigBite ? BIG_BITE_FOOD_BOOST : 1
  }

  buildPlates(): void {
    for (let i = 0; i < TRAY_SIZE; i++) {
      const glow = this.scene.add.image(0, 0, 'ftm-halo').setDepth(3)
      glow.setTint(GLOW_TINT).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD)
      this.glows.push(glow)

      const plate = this.scene.add.image(0, 0, 'ftm-plate').setDepth(4)
      this.dressPlate(plate)
      plate.setInteractive()
      plate.on('pointerdown', () => {
        playTone(659, 45, 'sine', 0.05)
        const baseX = plate.getData('baseSX') as number
        const baseY = plate.getData('baseSY') as number
        this.scene.tweens.killTweensOf(plate)
        this.scene.tweens.add({
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
  dressPlate(plate: Phaser.GameObjects.Image): void {
    const w = layout.plateWidth(this.scene.metrics())
    const marker = `marker-${this.scene.episode.id}`
    if (this.scene.hasArt(marker)) {
      if (plate.texture.key !== artKey(marker)) plate.setTexture(artKey(marker))
      plate.setDisplaySize(w, w * 0.5) // marker art is a 2:1 doily oval
    } else {
      if (plate.texture.key !== 'ftm-plate') plate.setTexture('ftm-plate')
      plate.setDisplaySize(w, w * 0.55) // procedural plate keeps its flatter oval
    }
    plate.setData('baseSX', plate.scaleX)
    plate.setData('baseSY', plate.scaleY)
  }

  /**
   * Re-anchor one tray slot to its layout position: the big-bite glow, then the
   * plate (reskinned — the episode may have changed since the last layout).
   * The glow pools slightly above the plate so it lights the food, not the floor.
   */
  placeSlot(index: number, slot: layout.XY): void {
    const w = layout.plateWidth(this.scene.metrics())
    this.glows[index]
      ?.setDisplaySize(w * GLOW_W_MUL, w * GLOW_H_MUL)
      .setPosition(slot.x, slot.y + this.px(4))
    const plate = this.plates[index]
    if (!plate) return
    this.dressPlate(plate)
    plate.setPosition(slot.x, slot.y + this.px(14))
  }

  // ─── Big bite ──────────────────────────────────────────────────────────────

  /**
   * Dress (or undress) the tray for a big-bite round: the slots light up with a
   * shimmer travelling along the row, the plates take a gold wash, and every
   * food grows by BIG_BITE_FOOD_BOOST. Idempotent, and safe to call MID-round —
   * a round that turns rough upgrades to a big bite while it is being played
   * (see the scene's spitBack), and the tray just grows into it.
   */
  setBigBite(on: boolean): void {
    if (on === this.bigBite) return
    this.bigBite = on

    this.glowPulse?.remove()
    this.glowPulse = undefined
    if (on) {
      this.glowPulse = this.scene.tweens.add({
        targets: this.glows,
        // Floor well above zero: this is the round's PERSISTENT signal, so the
        // trough must still be lit — a pulse to 0 would blink the state off
        // every second. The shimmer only brightens what is already on.
        alpha: { from: GLOW_ALPHA_LOW, to: GLOW_ALPHA_HIGH },
        // Staggered per glow — the lamps switch on down the row and the shimmer
        // then sweeps left→right for the whole round, pulling the eye to the tray.
        delay: (_t: unknown, _k: string, _v: number, i: number) => i * GLOW_STAGGER_MS,
        duration: 620,
        hold: 120,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    } else {
      this.scene.tweens.add({ targets: this.glows, alpha: 0, duration: 260 })
    }

    for (const plate of this.plates) {
      if (on) plate.setTint(PLATE_BIG_BITE_TINT)
      else plate.clearTint()
    }

    // Grow (or settle) the food already on the tray into the new base scale.
    for (const food of this.foods) {
      if (food === this.dragged) continue
      const to = this.foodBaseScale(food)
      this.scene.tweens.add({
        targets: food,
        scaleX: to,
        scaleY: to,
        duration: 320,
        ease: 'Back.easeOut',
      })
    }
  }

  buildTray(tray: string[]): void {
    for (const food of this.foods) {
      this.scene.tweens.killTweensOf(food)
      food.destroy()
    }
    this.foods = []
    this.dragged = null

    tray.forEach((foodId, i) => {
      const slot = layout.slotPos(this.scene.metrics(), i)
      const texKey = this.foodTexture(foodId)
      const img = this.scene.add.image(slot.x, -this.px(80), texKey).setDepth(5)
      img.setData('foodId', foodId)
      img.setData('slot', i)
      const frame = this.scene.textures.getFrame(texKey)
      // Reskin sprites arrive at atlas resolution — normalize them to the
      // emoji footprint; the hit circle stays ~100 css px either way (the
      // shape lives in unscaled frame coords, hence the /base).
      const base =
        (texKey === `ftm-food-${foodId}`
          ? 1
          : this.px(FOOD_CSS * 1.12) / Math.max(frame.width, frame.height)) *
        textures.foodScale(foodId)
      img.setData('baseScale', base)
      // Resting scale reads through foodBaseScale, so a big-bite round's foods
      // drop in already boosted (and the hit circle, sized in unscaled frame
      // coords below, grows with them).
      img.setScale(this.foodBaseScale(img))
      img.setInteractive(
        new Phaser.Geom.Circle(frame.width / 2, frame.height / 2, this.px(50) / base),
        Phaser.Geom.Circle.Contains,
      )
      this.scene.input.setDraggable(img)

      // Touch-down ack < 100ms; a plain tap (no drag) wiggles + boops.
      img.on('pointerdown', () => {
        if (this.dragged) return
        this.scene.tweens.add({
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
      this.scene.tweens.add({
        targets: img,
        y: slot.y,
        delay: i * 90,
        duration: 600,
        ease: 'Bounce.easeOut',
      })
      this.foods.push(img)
    })
  }

  // ─── Drag mechanics ────────────────────────────────────────────────────────

  /**
   * Make each food draggable: lift on dragstart, follow + snap-assist toward
   * the mouth on drag, and on dragend decide — a release inside the mouth snap
   * zone (while not transitioning) hands off to the scene to feed; otherwise the
   * food arcs back to its plate. The drop→feed decision stays orchestrated here
   * exactly as before (mouthWorld + snapRadius test), calling `scene.feed`.
   */
  wireDrag(): void {
    this.scene.input.dragDistanceThreshold = this.px(8)

    this.scene.input.on(
      'dragstart',
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const img = obj as Phaser.GameObjects.Image
        if (!this.foods.includes(img)) return
        this.scene.tweens.killTweensOf(img)
        this.dragged = img
        img.setDepth(20)
        img.setScale(this.foodBaseScale(img) * 1.15)
        playTone(523, 50, 'sine', 0.06)
      },
    )

    this.scene.input.on(
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
        // Magnetic snap assist toward the NEAREST open mouth (one in a solo
        // round, two in a duo); that mouth opens as the food approaches, the
        // others close.
        const snap = layout.snapRadius(this.scene.metrics())
        const mouths = this.scene.feedMouths()
        const near = this.nearestMouth(img, mouths)
        for (const mouth of mouths) {
          if (mouth === near.mouth && near.dist < snap) {
            img.x += (mouth.x - img.x) * 0.3
            img.y += (mouth.y - img.y) * 0.3
            if (mouth.isOpen() < 0.9) mouth.setOpen(1, 120)
          } else if (mouth.isOpen() > 0.1) {
            mouth.setOpen(0, 160)
          }
        }
      },
    )

    this.scene.input.on(
      'dragend',
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const img = obj as Phaser.GameObjects.Image
        if (img !== this.dragged) return
        this.dragged = null
        const snap = layout.snapRadius(this.scene.metrics())
        const mouths = this.scene.feedMouths()
        const near = this.nearestMouth(img, mouths)
        if (near.mouth && near.dist < snap && !this.scene.transitioning) {
          near.mouth.accept(img)
        } else {
          for (const mouth of mouths) mouth.setOpen(0, 160)
          this.returnToTray(img)
        }
      },
    )
  }

  /** The feed mouth closest to a dragged food, and its distance. */
  private nearestMouth(
    img: Phaser.GameObjects.Image,
    mouths: readonly FeedMouth[],
  ): { mouth: FeedMouth | null; dist: number } {
    let mouth: FeedMouth | null = null
    let dist = Infinity
    for (const candidate of mouths) {
      const d = Phaser.Math.Distance.Between(img.x, img.y, candidate.x, candidate.y)
      if (d < dist) {
        dist = d
        mouth = candidate
      }
    }
    return { mouth, dist }
  }

  // ─── Food motion ─────────────────────────────────────────────────────────

  fadeOutFood(food: Phaser.GameObjects.Image): void {
    if (!food.active) return
    food.disableInteractive()
    this.scene.tweens.killTweensOf(food)
    this.scene.tweens.add({
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
    const slot = layout.slotPos(this.scene.metrics(), img.getData('slot') as number)
    const base = this.foodBaseScale(img)
    img.disableInteractive()
    this.arcTo(img, slot.x, slot.y, 450, () => {
      img.setInteractive()
      if (this.scene.transitioning) this.fadeOutFood(img)
    })
    this.scene.tweens.add({
      targets: img,
      scaleX: base,
      scaleY: base,
      duration: 350,
      ease: 'Quad.easeOut',
    })
  }

  /** Move along a little arc (never teleport), with a playful spin. */
  arcTo(
    img: Phaser.GameObjects.Image,
    toX: number,
    toY: number,
    duration: number,
    onComplete: () => void,
  ): void {
    this.scene.tweens.killTweensOf(img)
    img.setDepth(20)
    const fromX = img.x
    const fromY = img.y
    const peak = Math.min(fromY, toY) - this.px(110)
    const state = { t: 0 }
    this.scene.tweens.add({
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
    if (obj === this.dragged || this.scene.tweens.isTweening(obj)) return
    const baseX = obj.x
    this.scene.tweens.add({
      targets: obj,
      x: baseX + this.px(6),
      duration: 60,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => obj.setX(baseX),
    })
  }
}

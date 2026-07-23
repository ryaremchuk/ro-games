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
import { artKey } from './art'
import * as layout from './layout'
import * as textures from './textures'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

// Mirrors the scene's FOOD_CSS: reskin sprites are normalized to this emoji
// footprint, so it must match the scene's value exactly (see journeyStage.ts for
// the same duplicate-to-avoid-a-value-import pattern).
const FOOD_CSS = 64

export class Tray {
  /** The plate sprites (the scene's layout() re-anchors + reskins them). */
  plates: Phaser.GameObjects.Image[] = []
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
   * normalized down from atlas resolution). All food scale tweens are
   * multiples of this. Public — the scene's layout()/feed/spit-back reuse it.
   */
  foodBaseScale(img: Phaser.GameObjects.Image): number {
    return (img.getData('baseScale') as number | undefined) ?? 1
  }

  buildPlates(): void {
    for (let i = 0; i < TRAY_SIZE; i++) {
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
      img.setScale(base)
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
        // Magnetic snap assist + the mouth opens as food approaches.
        const mouth = this.scene.monsterRig.mouthWorld()
        const dist = Phaser.Math.Distance.Between(img.x, img.y, mouth.x, mouth.y)
        if (dist < layout.snapRadius(this.scene.metrics())) {
          img.x += (mouth.x - img.x) * 0.3
          img.y += (mouth.y - img.y) * 0.3
          if (this.scene.monsterRig.mouthOpen < 0.9) this.scene.monsterRig.setMouthOpen(1, 120)
        } else if (this.scene.monsterRig.mouthOpen > 0.1) {
          this.scene.monsterRig.setMouthOpen(0, 160)
        }
      },
    )

    this.scene.input.on(
      'dragend',
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const img = obj as Phaser.GameObjects.Image
        if (img !== this.dragged) return
        this.dragged = null
        const mouth = this.scene.monsterRig.mouthWorld()
        const dist = Phaser.Math.Distance.Between(img.x, img.y, mouth.x, mouth.y)
        if (dist < layout.snapRadius(this.scene.metrics()) && !this.scene.transitioning) {
          this.scene.feed(img)
        } else {
          this.scene.monsterRig.setMouthOpen(0, 160)
          this.returnToTray(img)
        }
      },
    )
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

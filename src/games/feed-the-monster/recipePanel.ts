/**
 * The POT's OWN task panel — the recipe, drawn as an equation:
 * `ingredient + ingredient + … = finished dish`.
 *
 * A kitchen round carries two asks at once, and each one hangs over the thing it
 * is about: the friend's bubble says "bring me THIS" (one finished dish), this
 * panel says "cook THAT" (the parts, and what they make). A non-reader can only
 * tell two instructions apart if they are in two places, so the split IS the
 * teaching — the child looks at the pot to know what goes IN and at the friend to
 * know what comes OUT.
 *
 * It belongs to the POT, not to the round: `show()` takes a `Recipe`, never a
 * request, and progress is driven by what is in the pot (never by `eaten`), so a
 * pot that later stays on stage across a whole friend or episode can simply be
 * re-tasked with `show(nextRecipe)` and nothing here changes.
 *
 * `+` and `=` are drawn GLYPHS (procedural textures, like every other look in this
 * game), never text characters — the player cannot read.
 */
import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import * as layout from './layout'
import type { RecipeBox } from './layout'
import * as textures from './textures'
import type { Recipe } from './recipes'
import type { RecipeCellState, RecipePanelState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

/** An ingredient not yet in the pot sits ghosted — the game's "want" language. */
const GHOST_ALPHA = 0.5
/** The ✓ badge's width as a share of the ingredient it is stamped on. */
const CHECK_OF_TILE = 0.46
/** Pentatonic-happy tones, shared with the scene + the request bubble. */
const PENTA = [523, 587, 659, 784, 880]

export class RecipePanel {
  private readonly scene: FeedTheMonsterScene

  private root: Phaser.GameObjects.Container | null = null
  private plate!: Phaser.GameObjects.Graphics
  private hit: Phaser.GameObjects.Rectangle | null = null
  /** The ingredient tiles, in recipe order (index = pot position). */
  private parts: Phaser.GameObjects.Image[] = []
  private result: Phaser.GameObjects.Image | null = null

  private recipe: Recipe | null = null
  private ordered = false
  /** Which ingredients are already in the pot (survives a re-place / resize). */
  private readonly done = new Set<number>()
  private box: RecipeBox | null = null

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  // ─── Show / hide ───────────────────────────────────────────────────────────

  /**
   * Put a recipe on the pot's panel. Re-callable: a pot that stays on stage can
   * be handed the next recipe without being torn down.
   */
  show(recipe: Recipe, ordered: boolean): void {
    this.destroyRoot()
    this.recipe = recipe
    this.ordered = ordered
    this.done.clear()
    this.build()
    this.root?.setScale(0)
    this.scene.tweens.add({
      targets: this.root,
      scaleX: 1,
      scaleY: 1,
      duration: 340,
      ease: 'Back.easeOut',
    })
  }

  /** Take the panel down (the pot is leaving, or the round is over). */
  hide(): void {
    this.destroyRoot()
    this.recipe = null
    this.done.clear()
  }

  /**
   * The recipe is complete — the panel has said everything it had to say, so it
   * bows out as the finished dish pops out of the pot. That keeps exactly ONE ask
   * on screen for the delivery leg (the friend's), and it is also why the panel
   * may share the pot's airspace: the dish and the panel are never both up.
   */
  finish(): void {
    const root = this.root
    if (!root) return
    this.root = null
    this.recipe = null
    this.done.clear()
    this.parts = []
    this.result = null
    this.hit = null
    this.scene.tweens.killTweensOf(root)
    this.scene.tweens.add({
      targets: root,
      alpha: 0,
      scaleX: root.scaleX * 0.86,
      scaleY: root.scaleY * 0.86,
      duration: 300,
      ease: 'Quad.easeIn',
      onComplete: () => root.destroy(),
    })
  }

  /** Re-solve the geometry after a resize / orientation change. */
  place(): void {
    if (!this.recipe) return
    const wasVisible = this.root !== null
    this.destroyRoot()
    if (wasVisible) this.build()
  }

  private destroyRoot(): void {
    if (!this.root) return
    this.scene.tweens.killTweensOf(this.root)
    for (const part of this.parts) this.scene.tweens.killTweensOf(part)
    this.root.destroy()
    this.root = null
    this.parts = []
    this.result = null
    this.hit = null
  }

  // ─── Drawing ───────────────────────────────────────────────────────────────

  private build(): void {
    const recipe = this.recipe
    if (!recipe) return
    const n = recipe.ingredients.length
    const box = layout.recipePanel(this.scene.metrics(), n)
    this.box = box
    // Depth 6 = the friend's bubble layer: above the pot and the resting plates,
    // below a food in the child's hand (which the tray lifts to 20).
    const root = this.scene.add.container(box.x, box.y).setDepth(6)
    this.root = root

    this.plate = this.scene.add.graphics()
    root.add(this.plate)
    this.drawPlate(box)

    // Tapping the panel replays the recipe — its own task, its own cue.
    this.hit = this.scene.add.rectangle(0, 0, box.w, box.h, 0xffffff, 0)
    root.add(this.hit)
    this.hit.setInteractive()
    this.hit.on('pointerdown', () => {
      if (this.scene.transitioning) return
      this.playCue()
      this.scene.tweens.killTweensOf(root)
      this.scene.tweens.add({
        targets: root,
        scaleX: { from: 0.94, to: 1 },
        scaleY: { from: 0.94, to: 1 },
        duration: 240,
        ease: 'Back.easeOut',
      })
    })

    for (const cell of layout.recipeCells(box, n)) {
      if (cell.kind === 'plus' || cell.kind === 'equals') {
        root.add(this.scene.addMark(cell.dx, 0, cell.kind, cell.size))
        continue
      }
      const foodId = cell.kind === 'result' ? recipe.resultFoodId : recipe.ingredients[cell.index]
      const pic = this.scene.add.image(cell.dx, 0, this.scene.tray.foodTexture(foodId))
      const size = cell.size * textures.foodScale(foodId)
      pic.setDisplaySize(size, size)
      pic.setData('foodId', foodId)
      root.add(pic)
      if (cell.kind === 'result') {
        this.result = pic
      } else {
        this.parts[cell.index] = pic
        // An ingredient still to come is ghosted; one already in the pot is solid
        // and stamped — the exact language a count round's tiles use.
        if (this.done.has(cell.index)) this.stampCheck(pic)
        else pic.setAlpha(GHOST_ALPHA)
      }
    }
  }

  /**
   * The panel plate: a white rounded bar with the episode-tinted border the
   * friend's bubble uses (the two panels read as the same KIND of thing), plus a
   * tail on its pot-facing edge aimed at the pot — the picture-language link that
   * says "this task belongs to that pot".
   */
  private drawPlate(box: RecipeBox): void {
    const radius = Math.min(box.h * 0.36, this.px(26))
    const tailW = Math.min(box.h * 0.42, this.px(30))
    const tailH = Math.min(box.h * 0.3, this.px(20))
    const tailX = box.tailX - box.x
    const edge = box.below ? -box.h / 2 : box.h / 2
    const tip = box.below ? edge - tailH : edge + tailH

    this.plate.clear()
    this.plate.fillStyle(0xffffff, 0.96)
    this.plate.fillRoundedRect(-box.w / 2, -box.h / 2, box.w, box.h, radius)
    this.plate.fillTriangle(tailX - tailW / 2, edge, tailX + tailW / 2, edge, tailX, tip)
    this.plate.lineStyle(this.px(5), this.scene.episode.palette.table, 1)
    this.plate.strokeRoundedRect(-box.w / 2, -box.h / 2, box.w, box.h, radius)
    // The tail's two slanted sides only — its base is the panel's own edge.
    this.plate.lineBetween(tailX - tailW / 2, edge, tailX, tip)
    this.plate.lineBetween(tailX + tailW / 2, edge, tailX, tip)
  }

  /** Stamp the "got it" badge on an ingredient that is in the pot. */
  private stampCheck(pic: Phaser.GameObjects.Image): void {
    if (pic.getData('checked')) return
    pic.setData('checked', true)
    pic.setAlpha(1)
    const badge = this.scene
      .addMark(pic.x, pic.y, 'check', pic.displayWidth * CHECK_OF_TILE)
      .setAlpha(0.85)
    this.root?.add(badge)
    this.scene.tweens.add({
      targets: badge,
      scaleX: { from: 0, to: badge.scaleX },
      scaleY: { from: 0, to: badge.scaleY },
      duration: 220,
      ease: 'Back.easeOut',
    })
  }

  // ─── Progress ──────────────────────────────────────────────────────────────

  /** An ingredient went into the pot: its picture solidifies and takes a ✓. */
  markPart(index: number): void {
    this.done.add(index)
    const pic = this.parts[index]
    if (!pic || !pic.active || pic.getData('checked')) return
    this.scene.tweens.killTweensOf(pic)
    pic.setAlpha(1)
    this.scene.tweens.add({
      targets: pic,
      scaleX: { from: pic.scaleX * 1.25, to: pic.scaleX },
      scaleY: { from: pic.scaleY * 1.25, to: pic.scaleY },
      duration: 240,
      ease: 'Back.easeOut',
    })
    this.stampCheck(pic)
  }

  /** Punch one ingredient — "this one now" in an ordered recipe. */
  pulsePart(index: number): void {
    const pic = this.parts[index]
    if (!pic || !pic.active || this.done.has(index)) return
    this.scene.tweens.killTweensOf(pic)
    const sx = pic.scaleX
    const sy = pic.scaleY
    this.scene.tweens.add({
      targets: pic,
      scaleX: sx * 1.3,
      scaleY: sy * 1.3,
      duration: 220,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => pic.setScale(sx, sy),
    })
  }

  // ─── Audio ─────────────────────────────────────────────────────────────────

  /**
   * The recipe read aloud in tones: a rising note per ingredient (each tile
   * punching as its note sounds), then a bright chord on the result — "these go
   * together and MAKE that", which is the whole idea of the round. An ordered
   * recipe finishes by pointing at the part that has to go in first.
   */
  playCue(): void {
    const recipe = this.recipe
    if (!recipe || !this.root) return
    const n = recipe.ingredients.length
    for (let i = 0; i < n; i++) {
      this.scene.time.delayedCall(i * 190, () => {
        playTone(PENTA[i % PENTA.length], 150, 'sine', 0.1)
        this.pulsePart(i)
      })
    }
    this.scene.time.delayedCall(n * 190 + 160, () => {
      playTone(1047, 240, 'triangle', 0.11)
      const result = this.result
      if (result?.active && !this.scene.transitioning) {
        this.scene.tweens.add({
          targets: result,
          scaleX: { from: result.scaleX * 1.18, to: result.scaleX },
          scaleY: { from: result.scaleY * 1.18, to: result.scaleY },
          duration: 300,
          ease: 'Back.easeOut',
        })
      }
      if (this.ordered) this.pulsePart(0)
    })
  }

  // ─── E2E hook ──────────────────────────────────────────────────────────────

  /** Live panel geometry + contents for the dev/e2e hook (null when down). */
  snapshotState(): RecipePanelState | null {
    const recipe = this.recipe
    const box = this.box
    if (!recipe || !box || !this.root) return null
    const dpr = this.scene.dpr
    const cells: RecipeCellState[] = layout
      .recipeCells(box, recipe.ingredients.length)
      .map((c) => ({
        kind: c.kind,
        foodId:
          c.kind === 'result'
            ? recipe.resultFoodId
            : c.kind === 'part'
              ? recipe.ingredients[c.index]
              : null,
        done: c.kind === 'part' && this.done.has(c.index),
        xCss: (box.x + c.dx) / dpr,
        sizeCss: c.size / dpr,
      }))
    return {
      xCss: box.x / dpr,
      yCss: box.y / dpr,
      wCss: box.w / dpr,
      hCss: box.h / dpr,
      tileCss: box.tile / dpr,
      below: box.below,
      cells,
    }
  }
}

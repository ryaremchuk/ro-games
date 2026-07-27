/**
 * The bridge between the child's gallery and Feed the Monster's food catalog.
 *
 * A drawing becomes a food in three steps, all of them here: register its
 * texture on the scene (nearest-neighbour, so the blocks stay blocks), register
 * an ✏️ emoji strike as the graceful fallback if that texture ever fails, and
 * register the `Food` itself so every pure rule can resolve its id.
 *
 * Six slots, one per colour, newest-per-colour wins — the cap is a LEARNING
 * decision, not a storage one: an uncapped pool slowly replaces recognisable food
 * with blobs, and then "give me the two yellow ones" stops teaching anything. The
 * retired drawing stays in the gallery forever, it just stops being a food.
 */

import type Phaser from 'phaser'
import { clearRole, drawingToGrid, newestPerTag, saveDrawing } from '../../shared/pixel/artStore'
import type { Drawing } from '../../shared/pixel/artStore'
import { registerDrawingTexture } from '../../shared/pixel/drawingTexture'
import { clearRuntimeFoods, dominantColor, drawnFood, registerRuntimeFood } from './logic'
import type { Food, FoodColor } from './logic'
import { emojiTexture } from './textures'

const ROLE = 'ftm-food'

/**
 * The colour a drawing counts as. A commissioned drawing carries the asked
 * colour in its `tag`, so it is true by construction; only a "draw anything"
 * drawing (made below the colour-round unlock) falls back to reading its modal
 * colour, and only there does it matter that the read is approximate.
 */
export function colorOfDrawing(drawing: Drawing): FoodColor | null {
  const tagged = drawing.tag as FoodColor | undefined
  if (tagged !== undefined) return tagged
  return dominantColor(drawingToGrid(drawing).cells, drawing.palette)
}

/**
 * Make one drawing playable: texture, fallback glyph, catalog entry. Returns the
 * food, or null when the drawing carries no usable colour (a blank page).
 */
export function adoptDrawing(
  scene: Phaser.Scene,
  drawing: Drawing,
  opts: { dpr: number; foodCss: number; color?: FoodColor },
): Food | null {
  const color = opts.color ?? colorOfDrawing(drawing)
  if (color === null) return null
  const food = drawnFood(drawing.id, color)
  registerDrawingTexture(scene, drawing)
  emojiTexture(scene, opts.dpr, `ftm-food-${food.id}`, food.emoji, opts.foodCss)
  registerRuntimeFood(food)
  return food
}

/**
 * File a just-finished commission under the colour it actually counts as.
 *
 * The pad saves the page as soon as `done` is pressed (nothing the child makes is
 * ever lost), but the pad does not decide the colour: when the ask was "draw
 * something red" the tag is the ask, and when it was "draw anything" the colour
 * has to be read off the pixels first. Stamping it here — one place, after the
 * decision — is what keeps "six slots, one per colour" exact.
 */
export function stampDrawnFood(drawing: Drawing, color: FoodColor): Drawing {
  const stamped: Drawing = { ...drawing, role: ROLE, tag: color }
  saveDrawing(stamped)
  return stamped
}

/**
 * Every commissioned food the child owns right now — newest per colour, so at
 * most six — loaded into the scene and the catalog. Called on scene create and
 * after each fresh commission.
 */
export function loadDrawnFoods(
  scene: Phaser.Scene,
  opts: { dpr: number; foodCss: number },
): Food[] {
  const foods: Food[] = []
  for (const drawing of newestPerTag(ROLE)) {
    const food = adoptDrawing(scene, drawing, opts)
    if (food) foods.push(food)
  }
  return foods
}

/** Dev cheat: stop every drawing from being a food (the gallery keeps them all… */
export function wipeDrawnFoods(): void {
  // …except these, which were commissioned: dropping the role is what retires
  // them from the game, and it is the only way an adult can reset the pool.
  clearRole(ROLE)
  clearRuntimeFoods()
}

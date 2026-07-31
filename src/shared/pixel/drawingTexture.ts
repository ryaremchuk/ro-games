/**
 * The one place a child-made sprite becomes something a Phaser game can draw.
 *
 * A `Drawing` is `w × h` palette indices, so the whole conversion is: an
 * offscreen canvas at exactly `w × h` backing pixels, one pixel per cell, paper
 * cells left transparent, registered as a canvas texture with NEAREST filtering
 * so scaling it up stays crisp blocks instead of mush. No PNG encoding, no async
 * load, no preload phase — which is why the grid format matters more than it
 * looks.
 *
 * Every consuming game goes through here, so a drawing looks identical wherever
 * it turns up.
 */

import Phaser from 'phaser'
import { PAPER } from './palette'
import { drawingToGrid } from './artStore'
import type { Drawing } from './artStore'

/** Texture key for a drawing — stable, so re-registering is a no-op. */
export function drawingTextureKey(drawingId: string): string {
  return `ro-art-${drawingId}`
}

/**
 * Render a drawing to an offscreen canvas at 1 px per cell. Paper cells stay
 * fully transparent: what the child SEES on the pad is warm paper, what we
 * STORE and export is alpha 0 — the one place those deliberately differ, because
 * every reuse path needs real transparency.
 */
export function drawingToCanvas(drawing: Drawing): HTMLCanvasElement {
  const grid = drawingToGrid(drawing)
  const canvas = document.createElement('canvas')
  canvas.width = grid.w
  canvas.height = grid.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(grid.w, grid.h)
  for (let i = 0; i < grid.cells.length; i++) {
    const index = grid.cells[i]
    if (index === PAPER) continue
    const hex = drawing.palette[index]
    if (typeof hex !== 'string') continue
    const value = parseInt(hex.slice(1), 16)
    const at = i * 4
    image.data[at] = (value >> 16) & 0xff
    image.data[at + 1] = (value >> 8) & 0xff
    image.data[at + 2] = value & 0xff
    image.data[at + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/**
 * Register (once) a drawing as a scene texture and return its key. Idempotent —
 * an already-registered key is returned untouched, so a scene can call this on
 * every round without churning the texture manager.
 */
export function registerDrawingTexture(scene: Phaser.Scene, drawing: Drawing): string {
  const key = drawingTextureKey(drawing.id)
  if (scene.textures.exists(key)) return key
  const texture = scene.textures.addCanvas(key, drawingToCanvas(drawing))
  // Nearest-neighbour: a 16×16 sprite blown up to tray size must read as the
  // blocks the child painted, not a blurred smear.
  texture?.setFilter(Phaser.Textures.FilterMode.NEAREST)
  return key
}

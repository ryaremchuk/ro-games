/**
 * The child's gallery — every sprite they have ever painted, in localStorage.
 *
 * The saved unit is a GRID of palette indices, not a PNG: ~344 B for a 16×16,
 * ~5.5 KB for a 64×64, so a 100-drawing gallery stays well under a megabyte. It
 * is also re-renderable at any scale and inspectable in tests, which is what
 * makes "the child draws a food in the morning and the monster eats it in the
 * evening" cheap (see drawingTexture.ts).
 *
 * Mirrors shared/progress.ts: same key family (`ro-games:art:*`), same
 * in-memory fallback when localStorage is unavailable (private mode, quota), and
 * corrupt JSON is skipped rather than thrown so a bad entry can never brick a
 * game's boot.
 *
 * The one hard constraint of the whole reuse pipeline: WE CAN NEVER KNOW WHAT
 * THE CHILD DREW. So a drawing is only ever usable as a specific thing when the
 * game ASKED for it — `role` says which slot commissioned it and `tag` carries
 * the ask's parameter (e.g. the FoodColor). The tag is true because we asked for
 * it, not because anything was recognised.
 */

import { PALETTE } from './palette'
import { decodeCells, encodeCells } from './grid'
import type { Grid } from './grid'

/** Which slot commissioned a drawing. Absent for free play. */
export type DrawingRole = 'ftm-food' | 'whack-critter' | 'balloon-print'

export interface Drawing {
  v: 1
  /** Stable id; also the Phaser texture-key suffix. */
  id: string
  w: number
  h: number
  /** Hex per index; index 0 is transparent paper. Copied so a palette edit
   * never repaints art the child already made. */
  palette: string[]
  /** base64 of `w × h` bytes, one palette index per cell. */
  cells: string
  createdAt: number
  role?: DrawingRole
  /** The ask's parameter, when the commission carried one (e.g. 'red'). */
  tag?: string
}

const KEY = 'ro-games:art:drawings'

/**
 * Hard cap so a toddler tapping 🗑️ all afternoon can't fill the quota. Well
 * above a realistic gallery; the prune below never drops art a game is using.
 */
export const MAX_DRAWINGS = 120

/** In-memory fallback when localStorage is unavailable. */
let memoryStore: Drawing[] | null = null
/** Set once a write fails — from then on reads trust memory. */
let storageBroken = false

const listeners = new Set<() => void>()

/** Subscribe to any change in the gallery; returns the unsubscribe function. */
export function subscribeArt(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** Test hook: wipe the in-memory fallback between cases. */
export function resetArtMemory(): void {
  memoryStore = null
  storageBroken = false
}

function isDrawing(raw: unknown): raw is Drawing {
  if (typeof raw !== 'object' || raw === null) return false
  const d = raw as Record<string, unknown>
  return (
    d.v === 1 &&
    typeof d.id === 'string' &&
    d.id.length > 0 &&
    typeof d.w === 'number' &&
    Number.isFinite(d.w) &&
    d.w > 0 &&
    typeof d.h === 'number' &&
    Number.isFinite(d.h) &&
    d.h > 0 &&
    Array.isArray(d.palette) &&
    typeof d.cells === 'string' &&
    typeof d.createdAt === 'number' &&
    Number.isFinite(d.createdAt)
  )
}

function readAll(): Drawing[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      // One bad row is skipped; a bad document falls through to memory/empty.
      if (Array.isArray(parsed)) return parsed.filter(isDrawing)
    }
  } catch {
    storageBroken = true
  }
  if (storageBroken && memoryStore) return memoryStore.map((d) => ({ ...d }))
  return []
}

/**
 * Trim to MAX_DRAWINGS, oldest first — but NEVER the newest drawing of a
 * `(role, tag)` pair, because that is the one a game is currently rendering.
 */
function prune(drawings: Drawing[]): Drawing[] {
  if (drawings.length <= MAX_DRAWINGS) return drawings
  const protectedIds = new Set<string>()
  const seen = new Set<string>()
  // `drawings` is newest-first, so the first hit per key IS the newest.
  for (const drawing of drawings) {
    if (drawing.role === undefined) continue
    const key = `${drawing.role}:${drawing.tag ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    protectedIds.add(drawing.id)
  }
  const kept: Drawing[] = []
  // Walk oldest→newest and drop the oldest unprotected rows until we fit.
  let over = drawings.length - MAX_DRAWINGS
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i]
    if (over > 0 && !protectedIds.has(drawing.id)) {
      over--
      continue
    }
    kept.unshift(drawing)
  }
  return kept
}

function writeAll(drawings: Drawing[]): void {
  const pruned = prune(drawings)
  memoryStore = pruned.map((d) => ({ ...d }))
  try {
    localStorage.setItem(KEY, JSON.stringify(pruned))
  } catch {
    // Private mode / quota — the in-memory copy above keeps the session sane.
    storageBroken = true
  }
  emit()
}

/**
 * Every drawing, newest first. The stored array is already newest-first (saves
 * prepend), and Array.sort is stable, so same-millisecond drawings keep their
 * insertion order — the tie-break has to be exact for "newest red food wins".
 */
export function listDrawings(): Drawing[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt)
}

/** Drawings commissioned for a slot (optionally one specific ask), newest first. */
export function findDrawings(role: DrawingRole, tag?: string): Drawing[] {
  return listDrawings().filter((d) => d.role === role && (tag === undefined || d.tag === tag))
}

/** The newest drawing for a slot/ask, or null. */
export function newestDrawing(role: DrawingRole, tag?: string): Drawing | null {
  return findDrawings(role, tag)[0] ?? null
}

/**
 * The newest drawing per `tag` for a role — one per commissioned slot, which is
 * exactly the "six food colours, newest per colour wins" cap. Newest first.
 */
export function newestPerTag(role: DrawingRole): Drawing[] {
  const out: Drawing[] = []
  const seen = new Set<string>()
  for (const drawing of findDrawings(role)) {
    const tag = drawing.tag ?? ''
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(drawing)
  }
  return out
}

export function getDrawing(id: string): Drawing | null {
  return listDrawings().find((d) => d.id === id) ?? null
}

export function saveDrawing(drawing: Drawing): void {
  writeAll([drawing, ...readAll().filter((d) => d.id !== drawing.id)])
}

export function deleteDrawing(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id))
}

/** Parental / dev reset for one commissioned slot (the gallery keeps the rest). */
export function clearRole(role: DrawingRole): void {
  writeAll(readAll().filter((d) => d.role !== role))
}

// ─── Grid ↔ Drawing ───────────────────────────────────────────────────────────

let idCounter = 0

/** Unique even when two drawings are filed in the same millisecond. */
export function makeDrawingId(now: number = Date.now()): string {
  idCounter = (idCounter + 1) % 1_000_000
  return `${now.toString(36)}-${idCounter.toString(36)}`
}

export interface DrawingMeta {
  role?: DrawingRole
  tag?: string
  id?: string
  createdAt?: number
}

export function gridToDrawing(grid: Grid, meta: DrawingMeta = {}): Drawing {
  const createdAt = meta.createdAt ?? Date.now()
  return {
    v: 1,
    id: meta.id ?? makeDrawingId(createdAt),
    w: grid.w,
    h: grid.h,
    palette: [...PALETTE],
    cells: encodeCells(grid),
    createdAt,
    ...(meta.role !== undefined ? { role: meta.role } : {}),
    ...(meta.tag !== undefined ? { tag: meta.tag } : {}),
  }
}

export function drawingToGrid(drawing: Drawing): Grid {
  return { w: drawing.w, h: drawing.h, cells: decodeCells(drawing.cells, drawing.w, drawing.h) }
}

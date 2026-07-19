/**
 * Persistent per-game progress: skill meters and stars, stored in
 * localStorage so they survive app restarts (the games themselves stay
 * session-scoped — levels and celebrations reset every visit by design).
 *
 * Two decoupled currencies:
 * - SKILL — named adaptive meters (games define the axes, e.g. motor +
 *   cognitive). Invisible to the child; each session starts a bit BELOW the
 *   saved value (warm-up) and further below after a long break (decay), so a
 *   returning child re-enters through a friendly ramp instead of a cold
 *   start at their ceiling. See sessionStart().
 * - STARS — a forever-accumulating reward counter (+1 per celebration beat
 *   inside a game). Shown on the launcher tile; the one number that only
 *   ever grows, whatever the adaptive meters do.
 * - DATA — game-defined numeric state with no meter semantics (e.g. the
 *   feed-the-monster journey: episode / friends fed / growth step), saved so
 *   visible long-term progression survives restarts.
 *
 * Storage failures (private mode, quota) fall back to an in-memory map so a
 * session still behaves; it just won't survive a restart.
 */

export interface GameProgress {
  /** Cumulative reward stars — never reset, never decremented. */
  stars: number
  /** Saved adaptive meters, keyed by game-defined axis name. */
  skill: Record<string, number>
  /**
   * Game-defined numeric state that must survive restarts but is NOT an
   * adaptive meter (no warm-up/decay semantics) — e.g. feed-the-monster's
   * journey (episode / friends fed / growth step).
   */
  data: Record<string, number>
  /** Epoch ms of the last save, for the decay calculation. */
  lastPlayedAt: number | null
}

const KEY_PREFIX = 'ro-games:progress:'

/** Session warm-up: start this many steps below the saved meter. */
export const WARMUP_DROP = 2
/** Break decay: one extra step down per full week away. */
export const DECAY_PER_WEEK = 1
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** In-memory fallback when localStorage is unavailable. */
const memoryStore = new Map<string, GameProgress>()
/** Set once a localStorage write fails — from then on reads trust memory. */
let storageBroken = false

/** Test hook: wipe the in-memory fallback between test cases. */
export function resetProgressMemory(): void {
  memoryStore.clear()
  storageBroken = false
}

function emptyProgress(): GameProgress {
  return { stars: 0, skill: {}, data: {}, lastPlayedAt: null }
}

function copyFiniteNumbers(source: unknown, into: Record<string, number>): void {
  if (typeof source !== 'object' || source === null) return
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) into[key] = value
  }
}

function sanitize(raw: unknown): GameProgress {
  if (typeof raw !== 'object' || raw === null) return emptyProgress()
  const record = raw as Record<string, unknown>
  const progress = emptyProgress()
  if (typeof record.stars === 'number' && Number.isFinite(record.stars)) {
    progress.stars = Math.max(0, Math.floor(record.stars))
  }
  copyFiniteNumbers(record.skill, progress.skill)
  copyFiniteNumbers(record.data, progress.data)
  if (typeof record.lastPlayedAt === 'number' && Number.isFinite(record.lastPlayedAt)) {
    progress.lastPlayedAt = record.lastPlayedAt
  }
  return progress
}

/** Saved progress for a game; a fresh empty record if absent or corrupt. */
export function loadProgress(gameId: string): GameProgress {
  const key = KEY_PREFIX + gameId
  let broken = storageBroken
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return sanitize(JSON.parse(raw))
  } catch {
    broken = true
  }
  // An absent key only defers to memory when storage is known-broken —
  // otherwise localStorage's "no data" is authoritative.
  const memory = broken ? memoryStore.get(key) : undefined
  return memory ? structuredClone(memory) : emptyProgress()
}

function store(gameId: string, progress: GameProgress): void {
  const key = KEY_PREFIX + gameId
  memoryStore.set(key, structuredClone(progress))
  try {
    localStorage.setItem(key, JSON.stringify(progress))
  } catch {
    // Private mode / quota — the in-memory copy above keeps the session sane.
    storageBroken = true
  }
}

/** Save a game's skill meters (merged over any axes not mentioned). */
export function saveSkill(gameId: string, skill: Record<string, number>): void {
  const progress = loadProgress(gameId)
  progress.skill = { ...progress.skill, ...skill }
  progress.lastPlayedAt = Date.now()
  store(gameId, progress)
}

/** Save game-defined numeric state (merged over any keys not mentioned). */
export function saveData(gameId: string, data: Record<string, number>): void {
  const progress = loadProgress(gameId)
  progress.data = { ...progress.data, ...data }
  progress.lastPlayedAt = Date.now()
  store(gameId, progress)
}

/** Add reward stars (default 1); returns the new total. */
export function addStars(gameId: string, count = 1): number {
  const progress = loadProgress(gameId)
  progress.stars += Math.max(0, Math.floor(count))
  store(gameId, progress)
  return progress.stars
}

/** Total stars a game has ever awarded. */
export function getStars(gameId: string): number {
  return loadProgress(gameId).stars
}

export interface SessionStartOptions {
  /** Meter floor (default 0). */
  min?: number
  /** Meter ceiling. */
  max: number
  /** How far below the saved value a session starts (default WARMUP_DROP). */
  warmupDrop?: number
  /** When the meter was last saved (loadProgress().lastPlayedAt). */
  lastPlayedAt: number | null
  /** Injected clock for tests; defaults to Date.now(). */
  now?: number
}

/**
 * Where a session's adaptive meter starts: the saved value minus the warm-up
 * drop, minus one more step per full week since the last play (skills fade
 * over a break — re-teach gently). Clamped to [min, max]. Games are expected
 * to climb back FASTER while below the saved peak (their update rules take
 * the peak), so the warm-up lasts a couple of rounds, not half a session.
 */
export function sessionStart(saved: number, options: SessionStartOptions): number {
  const min = options.min ?? 0
  const warmupDrop = options.warmupDrop ?? WARMUP_DROP
  const now = options.now ?? Date.now()
  const away = options.lastPlayedAt === null ? 0 : Math.max(0, now - options.lastPlayedAt)
  const decay = Math.floor(away / WEEK_MS) * DECAY_PER_WEEK
  const start = Math.floor(saved) - warmupDrop - decay
  return Math.min(options.max, Math.max(min, start))
}

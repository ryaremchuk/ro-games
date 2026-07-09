import { MATERIALS, THEME_CYCLE } from '../logic'
import type {
  BirdKind,
  BlockMaterial,
  BlockSpec,
  LevelSpec,
  PiggySpec,
  PropKind,
  PropSpec,
  Theme,
} from '../logic'

/**
 * Strict, sanitizing parser for hand-edited / imported `LevelSpec` JSON.
 *
 * The editor round-trips levels through the clipboard and localStorage, so any
 * string can arrive here. The parser rebuilds the spec field-by-field (unknown
 * fields are dropped, never passed through to the scene) and rejects anything
 * the physics build couldn't survive: NaN coordinates, unknown materials,
 * empty bird queues, absurd object counts.
 */

export const MAX_BLOCKS = 80
export const MAX_PIGGIES = 12
export const MAX_PROPS = 16
export const MAX_BIRDS = 8

/** Coordinates may overhang the field slightly (editor clamps on drop). */
const COORD_MIN = -0.2
const COORD_MAX = 1.2

export type ParseResult = { ok: true; spec: LevelSpec } | { ok: false; error: string }

const PROP_KINDS: readonly PropKind[] = ['trampoline', 'ball', 'seesaw']
const BIRD_KINDS: readonly BirdKind[] = ['normal', 'big']

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function num(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null
}

function fail(error: string): ParseResult {
  return { ok: false, error }
}

function parseBlock(v: unknown, i: number): BlockSpec | string {
  if (typeof v !== 'object' || v === null) return `blocks[${i}] must be an object`
  const o = v as Record<string, unknown>
  const material = o.material as BlockMaterial
  if (!Object.prototype.hasOwnProperty.call(MATERIALS, material)) {
    return `blocks[${i}].material must be one of ${Object.keys(MATERIALS).join('/')}`
  }
  const x = num(o.x, COORD_MIN, COORD_MAX)
  const y = num(o.y, COORD_MIN, COORD_MAX)
  const w = num(o.w, 0.005, 0.6)
  const h = num(o.h, 0.005, 0.6)
  const angle = num(o.angle ?? 0, -7, 7)
  if (x === null || y === null)
    return `blocks[${i}].x/y must be numbers in [${COORD_MIN}, ${COORD_MAX}]`
  if (w === null || h === null) return `blocks[${i}].w/h must be numbers in [0.005, 0.6]`
  if (angle === null) return `blocks[${i}].angle must be a number in [-7, 7] (radians)`
  return { material, x, y, w, h, angle }
}

function parsePiggy(v: unknown, i: number): PiggySpec | string {
  if (typeof v !== 'object' || v === null) return `piggies[${i}] must be an object`
  const o = v as Record<string, unknown>
  const x = num(o.x, COORD_MIN, COORD_MAX)
  const y = num(o.y, COORD_MIN, COORD_MAX)
  if (x === null || y === null)
    return `piggies[${i}].x/y must be numbers in [${COORD_MIN}, ${COORD_MAX}]`
  return { x, y }
}

function parseProp(v: unknown, i: number): PropSpec | string {
  if (typeof v !== 'object' || v === null) return `props[${i}] must be an object`
  const o = v as Record<string, unknown>
  const kind = o.kind as PropKind
  if (!PROP_KINDS.includes(kind)) return `props[${i}].kind must be one of ${PROP_KINDS.join('/')}`
  const x = num(o.x, COORD_MIN, COORD_MAX)
  const y = num(o.y, COORD_MIN, COORD_MAX)
  if (x === null || y === null)
    return `props[${i}].x/y must be numbers in [${COORD_MIN}, ${COORD_MAX}]`
  const prop: PropSpec = { kind, x, y }
  for (const dim of ['w', 'h', 'r'] as const) {
    if (o[dim] === undefined) continue
    const value = num(o[dim], 0.005, 0.6)
    if (value === null) return `props[${i}].${dim} must be a number in [0.005, 0.6]`
    prop[dim] = value
  }
  return prop
}

export function parseLevelSpec(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return fail('Not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('Top level must be an object')
  }
  const o = raw as Record<string, unknown>

  if (typeof o.level !== 'number' || !Number.isInteger(o.level) || o.level < 1 || o.level > 9999) {
    return fail('level must be an integer in [1, 9999]')
  }
  const theme = o.theme as Theme
  if (!THEME_CYCLE.includes(theme)) {
    return fail(`theme must be one of ${THEME_CYCLE.join('/')}`)
  }
  const gravityScale = num(o.gravityScale, 0.05, 3)
  if (gravityScale === null) return fail('gravityScale must be a number in [0.05, 3]')

  if (!Array.isArray(o.birds) || o.birds.length < 1 || o.birds.length > MAX_BIRDS) {
    return fail(`birds must be an array of 1..${MAX_BIRDS} entries`)
  }
  const birds: BirdKind[] = []
  for (const b of o.birds) {
    if (!BIRD_KINDS.includes(b as BirdKind))
      return fail(`birds entries must be ${BIRD_KINDS.join('/')}`)
    birds.push(b as BirdKind)
  }

  if (!Array.isArray(o.blocks) || o.blocks.length > MAX_BLOCKS) {
    return fail(`blocks must be an array of at most ${MAX_BLOCKS}`)
  }
  if (!Array.isArray(o.piggies) || o.piggies.length < 1 || o.piggies.length > MAX_PIGGIES) {
    return fail(`piggies must be an array of 1..${MAX_PIGGIES} (a level needs a piggy)`)
  }
  if (!Array.isArray(o.props) || o.props.length > MAX_PROPS) {
    return fail(`props must be an array of at most ${MAX_PROPS}`)
  }

  const blocks: BlockSpec[] = []
  for (let i = 0; i < o.blocks.length; i++) {
    const r = parseBlock(o.blocks[i], i)
    if (typeof r === 'string') return fail(r)
    blocks.push(r)
  }
  const piggies: PiggySpec[] = []
  for (let i = 0; i < o.piggies.length; i++) {
    const r = parsePiggy(o.piggies[i], i)
    if (typeof r === 'string') return fail(r)
    piggies.push(r)
  }
  const props: PropSpec[] = []
  for (let i = 0; i < o.props.length; i++) {
    const r = parseProp(o.props[i], i)
    if (typeof r === 'string') return fail(r)
    props.push(r)
  }

  return {
    ok: true,
    spec: { level: o.level, theme, gravityScale, birds, blocks, piggies, props },
  }
}

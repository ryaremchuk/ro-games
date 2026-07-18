/**
 * Pure Simon-round logic for Animal Band. No DOM, no audio, no timers —
 * everything here is deterministic given an injected RNG and is unit-tested
 * in logic.test.ts. The component consumes these transitions at event
 * granularity (tap / round boundaries) only.
 */

export type Rng = () => number

/** Number of pads on stage at once. */
export const BAND_SIZE = 4

/**
 * Fixed pitch per pad position, left → right: C5 E5 G5 C6. A major-triad
 * spread, so any tap order sounds harmonious (per design brief).
 */
export const PAD_PITCHES = [523, 659, 784, 1047] as const

/** Fixed pad color per position (palette accents; purple is the stage). */
export const PAD_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF'] as const

export interface Animal {
  id: string
  /** Accessibility label only — the child never reads text. */
  name: string
  emoji: string
  /** The pitch this animal always sings, in every band line-up. */
  pitch: (typeof PAD_PITCHES)[number]
  /** The pad color this animal always stands on. */
  color: (typeof PAD_COLORS)[number]
}

/**
 * Pool of 8 performers. Pitch and pad color are tied to the animal forever:
 * animal i sings PAD_PITCHES[i % 4] on a PAD_COLORS[i % 4] pad, so any window
 * of 4 consecutive animals covers each pad slot exactly once and rotating the
 * band never moves a pitch or a color to a different pad position.
 */
export const ANIMALS: readonly Animal[] = [
  { id: 'dog', name: 'Dog', emoji: '🐶', pitch: 523, color: '#FF6B6B' },
  { id: 'cat', name: 'Cat', emoji: '🐱', pitch: 659, color: '#FFD93D' },
  { id: 'frog', name: 'Frog', emoji: '🐸', pitch: 784, color: '#6BCB77' },
  { id: 'chick', name: 'Chick', emoji: '🐥', pitch: 1047, color: '#4D96FF' },
  { id: 'lion', name: 'Lion', emoji: '🦁', pitch: 523, color: '#FF6B6B' },
  { id: 'pig', name: 'Pig', emoji: '🐷', pitch: 659, color: '#FFD93D' },
  { id: 'monkey', name: 'Monkey', emoji: '🐵', pitch: 784, color: '#6BCB77' },
  { id: 'panda', name: 'Panda', emoji: '🐼', pitch: 1047, color: '#4D96FF' },
] as const

/** Sequences start at working-memory-friendly length 2 (child-dev norms). */
export const START_LENGTH = 2

/** Soft cap — a 4yo ceiling is ~5; 8 keeps "endless" without absurdity. */
export const MAX_LENGTH = 8

/** Consecutive wrong attempts at a length before we drop back + hint. */
export const FAILS_TO_DROP = 2

/** Echoing a sequence this long earns the star-shower celebration. */
export const STAR_LENGTH = 5

/** The band line-up rotates after this many successful rounds. */
export const ROTATE_EVERY = 3

/**
 * The 4 animals on stage for a given rotation, ordered by pad position
 * (pitch ascending). Takes a window of 4 consecutive pool animals, then
 * slots each onto the pad matching its own pitch — so faces rotate for
 * novelty while every pad keeps its pitch and color.
 */
export function stageBand(rotation: number): Animal[] {
  const n = ANIMALS.length
  const start = ((rotation % n) + n) % n
  const window = Array.from({ length: BAND_SIZE }, (_, i) => ANIMALS[(start + i) % n])
  return PAD_PITCHES.map((pitch) => {
    const animal = window.find((a) => a.pitch === pitch)
    if (!animal) throw new Error(`No animal for pitch ${pitch} in rotation ${rotation}`)
    return animal
  })
}

/** Band line-up derived from progress: rotate every ROTATE_EVERY successes. */
export function bandForRounds(roundsCompleted: number): Animal[] {
  return stageBand(Math.floor(roundsCompleted / ROTATE_EVERY))
}

/**
 * Random pad index, optionally excluding one pad. Immediate repeats are
 * excluded when generating sequences — "same pad twice" doesn't read as two
 * events to a pre-reader.
 */
export function randomPad(rng: Rng, exclude?: number): number {
  if (exclude === undefined) {
    return Math.min(BAND_SIZE - 1, Math.floor(rng() * BAND_SIZE))
  }
  const pick = Math.min(BAND_SIZE - 2, Math.floor(rng() * (BAND_SIZE - 1)))
  return pick >= exclude ? pick + 1 : pick
}

/** Fresh sequence of pad indices with no immediate repeats. */
export function newSequence(length: number, rng: Rng): number[] {
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    seq.push(randomPad(rng, seq[i - 1]))
  }
  return seq
}

/** Simon-style growth: keep the known prefix, append one new step. */
export function extendSequence(sequence: readonly number[], rng: Rng): number[] {
  return [...sequence, randomPad(rng, sequence[sequence.length - 1])]
}

export type TapResult = 'correct' | 'complete' | 'wrong'

/**
 * Validate one echo tap against the sequence at the current progress.
 * `progress` = how many steps have already been echoed correctly.
 */
export function checkTap(sequence: readonly number[], progress: number, pad: number): TapResult {
  if (sequence[progress] !== pad) return 'wrong'
  return progress + 1 >= sequence.length ? 'complete' : 'correct'
}

export interface BandState {
  /** Current sequence of pad indices the child must echo. */
  sequence: number[]
  /** Consecutive wrong attempts at the current length. */
  failsAtLength: number
  /** Pre-glow hints during echo (enabled after a drop-back). */
  hints: boolean
  /** Total successful echoes — drives band rotation. */
  roundsCompleted: number
}

/**
 * Fresh session state. `startLength` resumes a persisted skill (clamped to
 * the ladder) — the sequence length IS this game's adaptive meter.
 */
export function initialBandState(rng: Rng, startLength: number = START_LENGTH): BandState {
  const length = Math.min(MAX_LENGTH, Math.max(START_LENGTH, Math.round(startLength)))
  return {
    sequence: newSequence(length, rng),
    failsAtLength: 0,
    hints: false,
    roundsCompleted: 0,
  }
}

/**
 * Full echo correct: grow the sequence by 1 (keeping the known prefix),
 * clear hints and the fail streak. At the cap, roll a fresh max-length
 * sequence instead so rounds never repeat verbatim.
 */
export function applySuccess(state: BandState, rng: Rng): BandState {
  const sequence =
    state.sequence.length < MAX_LENGTH
      ? extendSequence(state.sequence, rng)
      : newSequence(MAX_LENGTH, rng)
  return {
    sequence,
    failsAtLength: 0,
    hints: false,
    roundsCompleted: state.roundsCompleted + 1,
  }
}

/**
 * Wrong tap: never game over. First miss just replays the same sequence.
 * After FAILS_TO_DROP consecutive misses, drop back exactly one step (never
 * below START_LENGTH, keeping the already-heard prefix) and turn on hints.
 */
export function applyFail(state: BandState): BandState {
  const fails = state.failsAtLength + 1
  if (fails < FAILS_TO_DROP) {
    return { ...state, failsAtLength: fails }
  }
  const length = Math.max(START_LENGTH, state.sequence.length - 1)
  return {
    sequence: state.sequence.slice(0, length),
    failsAtLength: 0,
    hints: true,
    roundsCompleted: state.roundsCompleted,
  }
}

export type CelebrationTier = 'cheer' | 'stars'

/** Echoing STAR_LENGTH+ steps is exceptional for a 4yo — star shower. */
export function celebrationTier(echoedLength: number): CelebrationTier {
  return echoedLength >= STAR_LENGTH ? 'stars' : 'cheer'
}

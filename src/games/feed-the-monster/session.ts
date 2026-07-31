/**
 * The SESSION SETLIST — which KIND of round comes next. Pure, no Phaser, fully
 * seedable (session.test.ts).
 *
 * This is the game's third axis, and the reason it exists is a measurement: a
 * 3–4-year-old sustains attention on one activity for roughly 3–6 minutes, so a
 * session here is about six to twelve rounds and then the iPad goes down. The
 * old scheme rolled an independent per-round chance for each rare mode, which
 * spends a short session on whatever the dice say — often nothing but classic
 * rounds. A setlist spends it on a composed sequence instead.
 *
 * Three axes, kept strictly apart:
 *  1. **This module — the round MODE.** Where the food comes from and who is on
 *     stage. Pure variety: it does NOT read the difficulty meter, on purpose.
 *  2. The cognitive meter (logic.ts) — how hard the ASK is inside whatever mode
 *     is running. That is where difficulty lives, all of it.
 *  3. The sprinkles (journey's big bite, thief.ts's bird) — layered on top of
 *     any mode on their own variable schedule.
 *
 * The shape of a setlist, and why:
 *
 *   classic ×3   kitchen ×3   classic ×2   conveyor ×2   classic ×2   duo ×1
 *   └ warm-up ┘  └ block ──┘  └ breather┘  └ block ───┘  └ breather┘  └ treat┘
 *
 *  - **Modes come in BLOCKS, tasks are interleaved inside them.** Blocked practice
 *    gets a learner to competence on a new interaction faster; interleaved practice
 *    is what actually sticks. A mode is an interaction (a belt, a pot) and a task is
 *    the learning, so each gets the schedule it wants: two or three rounds of one
 *    mode is long enough that the child stops fighting the interface and starts
 *    playing it, while the ask underneath keeps rotating every round.
 *  - **A classic block always sits between two specials.** It is the breather, and
 *    it is why `classic` is not in the deck at all — it is structural, not drawn.
 *  - **The first block is always classic**, so a session opens on the interaction
 *    the child knows best.
 *  - **The deck is drawn WITHOUT REPLACEMENT.** Rotating a small set is what makes
 *    old things feel new; independent per-round dice give droughts and clusters
 *    instead. A weight is simply how many copies of a mode are in the deck.
 *
 * Nothing here consults the episode except through UNLOCKS: a mode is either in
 * the deck or not, and past that the sequence is the same forever. The journey
 * decides WHAT the child has met, the setlist decides when they play it.
 */

import type { Rng } from './logic'

/** The kind of round on stage — where the food comes from, and who wants it. */
export type RoundMode =
  /** The still plate row. Every cognitive task kind can run here. */
  | 'classic'
  /** The kaiten belt (conveyorMode) — food rides past. */
  | 'conveyor'
  /** The pot (kitchenMode) — cook the recipe, feed what comes out. */
  | 'kitchen'
  /** Two little friends, one shared tray (duoMode). */
  | 'duo'

/** Every mode that is DRAWN from the deck; `classic` is structural, not drawn. */
export type SpecialMode = Exclude<RoundMode, 'classic'>

export const SPECIAL_MODES: readonly SpecialMode[] = ['kitchen', 'conveyor', 'duo']

/**
 * 0-based episode at which each special joins the deck.
 *
 * Episode 1 is where the game opens up — the drawing commission unlocks there too
 * (journey.COMMISSION_MIN_EPISODE), so the child meets the pot, the belt and the
 * easel in the same stretch, having spent episode 0 learning the core loop on
 * nothing but the still tray. The duo waits one episode more because it changes
 * who is on stage rather than what the food does.
 */
export const MODE_UNLOCK_EPISODE: Record<SpecialMode, number> = {
  kitchen: 1,
  conveyor: 1,
  duo: 2,
}

/**
 * Copies of each special in a freshly shuffled deck — i.e. its relative frequency.
 *
 * The pot is the richest of the three (a recipe to read, a two-step goal, and it
 * grows with the meter from two parts to four), so it gets the most copies.
 *
 * The duo is a one-block treat, but it still gets TWO: a duo BLOCK is a single
 * round where the others run two or three, so with one card it worked out at ~3% of
 * rounds — most sessions would never see one, which is the opposite of what a
 * variety axis is for. Two lands it a little over once per episode, which is what
 * the duo was designed for when it had its own axis.
 */
export const MODE_WEIGHT: Record<SpecialMode, number> = {
  kitchen: 3,
  conveyor: 2,
  duo: 2,
}

/**
 * How many rounds one block of a mode runs, as an inclusive range.
 *
 * Two is the floor for anything with new furniture: a single round of a belt is
 * over before the child has worked out that the plates move. A duo is 1 because a
 * duo round is itself a three-feed sequence (journey.DUO_GROW_STEPS) — the block
 * is already long.
 */
export const BLOCK_ROUNDS: Record<RoundMode, { min: number; max: number }> = {
  classic: { min: 2, max: 3 },
  kitchen: { min: 2, max: 3 },
  conveyor: { min: 2, max: 3 },
  duo: { min: 1, max: 1 },
}

/**
 * The session's opening classic block, in rounds — one longer than a breather.
 * A returning child re-enters through the meter's warm-up
 * (shared/progress.sessionStart) at the same time, so the first minute is
 * deliberately the most familiar thing the game has.
 */
export const WARMUP_ROUNDS = 3

export interface SetlistState {
  /** The mode the current block is playing. */
  mode: RoundMode
  /** Rounds of this block not yet served (0 = the next round opens a new block). */
  left: number
  /** Specials not yet drawn from the current deck. */
  deck: readonly SpecialMode[]
  /** The special the last special block played — never the next deck's first card. */
  lastSpecial: SpecialMode | null
  /** Blocks started this session (the first is the warm-up). */
  blocks: number
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** Which specials the journey has unlocked (deck contents, before weighting). */
export function unlockedSpecials(episode: number): SpecialMode[] {
  return SPECIAL_MODES.filter((mode) => episode >= MODE_UNLOCK_EPISODE[mode])
}

/**
 * A fresh shuffled deck: `MODE_WEIGHT[mode]` copies of every unlocked special.
 *
 * `avoid` is the special that just played. It is not removed — that would distort
 * the weights — it is only barred from the FIRST position, so a deck boundary can
 * never produce the same mode twice in a row (the one place where drawing without
 * replacement would otherwise allow a repeat).
 */
export function buildDeck(episode: number, avoid: SpecialMode | null, rng: Rng): SpecialMode[] {
  const deck: SpecialMode[] = []
  for (const mode of unlockedSpecials(episode)) {
    for (let i = 0; i < MODE_WEIGHT[mode]; i++) deck.push(mode)
  }
  shuffle(rng, deck)
  if (avoid !== null && deck.length > 1 && deck[0] === avoid) {
    const other = deck.findIndex((mode) => mode !== avoid)
    if (other > 0) [deck[0], deck[other]] = [deck[other], deck[0]]
  }
  return deck
}

/** A session opens on a longer-than-usual classic block; the deck is drawn later. */
export function initialSetlist(): SetlistState {
  return { mode: 'classic', left: WARMUP_ROUNDS, deck: [], lastSpecial: null, blocks: 1 }
}

/** What the setlist needs to know about the world to pick the next block. */
export interface SetlistContext {
  /** 0-based journey episode — the ONLY gate on which modes exist. */
  episode: number
  /**
   * May a duo start right now? A duo grows a PAIR on its own synchronized curve
   * and graduates both, so the journey only allows one at a friend boundary with
   * two episode slots free (see journey.duoComplete). A duo that is drawn while
   * this is false is put back at the head of the deck rather than discarded, so it
   * plays at the next block boundary that will take it.
   */
  duoAllowed: boolean
}

/**
 * Advance the setlist by one round and say which mode that round plays.
 *
 * Called once per round with the live world; returns the next state, so the caller
 * holds no scheduling logic of its own. Mid-block it just decrements. At a block
 * boundary it alternates: a special block is always followed by a classic
 * breather, a classic block always draws the next special.
 */
export function nextRound(
  state: SetlistState,
  ctx: SetlistContext,
  rng: Rng,
): { mode: RoundMode; state: SetlistState } {
  const block = state.left >= 1 ? state : startBlock(state, ctx, rng)
  return { mode: block.mode, state: { ...block, left: block.left - 1 } }
}

/**
 * Open the next block: a breather after a special, a fresh special after classic.
 * `left` comes back as the block's FULL length; nextRound spends the first round of
 * it immediately.
 */
function startBlock(state: SetlistState, ctx: SetlistContext, rng: Rng): SetlistState {
  if (state.mode !== 'classic') {
    return {
      mode: 'classic',
      left: randInt(rng, BLOCK_ROUNDS.classic.min, BLOCK_ROUNDS.classic.max),
      deck: state.deck,
      lastSpecial: state.mode,
      blocks: state.blocks + 1,
    }
  }

  const drawn = drawSpecial(state, ctx, rng)
  if (!drawn) {
    // Nothing unlocked yet (episode 0), or the only card left cannot play right
    // now: another classic block. The deck is untouched, so it gets its chance at
    // the next boundary.
    return {
      ...state,
      mode: 'classic',
      left: randInt(rng, BLOCK_ROUNDS.classic.min, BLOCK_ROUNDS.classic.max),
      blocks: state.blocks + 1,
    }
  }
  const range = BLOCK_ROUNDS[drawn.mode]
  return {
    mode: drawn.mode,
    left: randInt(rng, range.min, range.max),
    deck: drawn.deck,
    lastSpecial: state.lastSpecial,
    blocks: state.blocks + 1,
  }
}

/**
 * Take the next special off the deck, refilling it when empty.
 *
 * Two kinds of card get SKIPPED — never discarded, they keep their place and are
 * the next ones considered:
 *  - one the world cannot host right now (a duo away from a friend boundary);
 *  - one that would repeat the special that just played. `kitchen` holds three of
 *    the seven cards, so without this the deck happily deals
 *    kitchen → breather → kitchen, and a four-minute session can end up having seen
 *    exactly one special mode.
 *
 * A deck whose remaining cards are all skippable is topped up with a fresh one
 * BEHIND them, so the skipped cards keep their turn and the draw still happens.
 *
 * Returns null only when NOTHING is playable — in practice episode 0, where no
 * special is unlocked and the deck is empty by construction. The caller turns that
 * into another classic block.
 */
function drawSpecial(
  state: SetlistState,
  ctx: SetlistContext,
  rng: Rng,
): { mode: SpecialMode; deck: SpecialMode[] } | null {
  let deck =
    state.deck.length > 0 ? [...state.deck] : buildDeck(ctx.episode, state.lastSpecial, rng)
  const fresh = (mode: SpecialMode): boolean => playable(mode, ctx) && mode !== state.lastSpecial
  if (!deck.some(fresh)) deck = [...deck, ...buildDeck(ctx.episode, state.lastSpecial, rng)]

  // A non-repeat first; failing that, ANY playable card. The fallback is
  // unreachable while two specials unlock together (they do — see
  // MODE_UNLOCK_EPISODE), and it exists so that a future ladder unlocking exactly
  // one special cannot stall the axis: with only repeats available, `lastSpecial`
  // would never change again and the game would be classic forever. A repeated
  // block is a far better failure than a dead axis.
  const at = deck.findIndex(fresh)
  const pick = at >= 0 ? at : deck.findIndex((mode) => playable(mode, ctx))
  if (pick < 0) return null
  return { mode: deck[pick], deck: [...deck.slice(0, pick), ...deck.slice(pick + 1)] }
}

/** Can this special run in the world as it stands right now? */
function playable(mode: SpecialMode, ctx: SetlistContext): boolean {
  return mode === 'duo' ? ctx.duoAllowed : true
}

// ─── The bird's own gate ──────────────────────────────────────────────────────

/**
 * 0-based episode from which the thief may visit. Same gate as the belt and the
 * pot: episode 0 stays the plain loop, and everything arrives together after the
 * first dance party. (The bird used to be gated on the COGNITIVE meter, which made
 * the funniest thing in the game a reward for being good at counting.)
 */
export const THIEF_UNLOCK_EPISODE = 1

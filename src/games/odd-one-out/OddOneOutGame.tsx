import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { playTone } from '../../shared/audio'
import { reportLevel } from '../../shared/level'
import { addStars, loadProgress, saveSkill, sessionStart } from '../../shared/progress'
import {
  clampLevel,
  initialSessionState,
  isCelebrationSolve,
  MAX_LEVEL,
  MIN_LEVEL,
  nextPuzzle,
  registerMiss,
  registerSolve,
  showHint,
} from './logic'
import type { Puzzle, SessionState } from './logic'
import './OddOneOutGame.css'

/** Registry id — also the key the shared progress store files this under. */
const GAME_ID = 'odd-one-out'

/**
 * Resume the saved ladder one level down (session warm-up; lower still after
 * a long break) with the saved level as the peak, so registerSolve climbs
 * back at warm-up speed.
 */
function startSession(): SessionState {
  const saved = loadProgress(GAME_ID)
  const savedLevel = clampLevel(saved.skill.cognitive ?? MIN_LEVEL)
  const startLevel = clampLevel(
    sessionStart(savedLevel, {
      min: MIN_LEVEL,
      max: MAX_LEVEL,
      warmupDrop: 1,
      lastPlayedAt: saved.lastPlayedAt,
    }),
  )
  return initialSessionState(startLevel, savedLevel)
}

/**
 * Game phases (event-granularity React state — sequencing runs on setTimeout
 * chains held in refs, never per-frame state):
 * - intro: cards drop onto the table (Bounce-style, staggered) + soft pops.
 * - play: waiting for the child to tap the odd one.
 * - solved: odd item dances + exits, the trio clap-bounces, confetti, sticker.
 */
type Phase = 'intro' | 'play' | 'solved'

const DROP_MS = 650
const DROP_STAGGER_MS = 100
const INTRO_MS = DROP_MS + DROP_STAGGER_MS * 3 + 150
const STICKER_AT_MS = 700
const NEXT_ROUND_MS = 1750
const HUDDLE_AT_MS = 320

const CHIME_NOTES = [523, 659, 784, 1047]
const LEVEL_UP_NOTES = [523, 587, 659, 784, 880, 1047]
const POP_NOTES = [392, 440, 494, 523]
const CONFETTI_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF8FAB', '#4ECDC4']

interface Sticker {
  key: number
  emoji: string
  name: string
}

/** Decorations (blobs, shelf stickers, the whole room) wiggle when poked. */
function wobble(el: HTMLElement) {
  el.animate(
    [
      { transform: 'rotate(0deg) translateX(0px)' },
      { transform: 'rotate(0.8deg) translateX(4px)' },
      { transform: 'rotate(-0.8deg) translateX(-4px)' },
      { transform: 'rotate(0.4deg) translateX(2px)' },
      { transform: 'rotate(0deg) translateX(0px)' },
    ],
    { duration: 450, easing: 'ease-in-out' },
  )
}

export default function OddOneOutGame() {
  const [session, setSession] = useState<SessionState>(startSession)
  const [puzzle, setPuzzle] = useState<Puzzle>(() => nextPuzzle(session, Math.random))
  const [phase, setPhase] = useState<Phase>('intro')
  const [round, setRound] = useState(0)
  const [stickers, setStickers] = useState<Sticker[]>([])

  // Refs mirror the state the tap handlers need synchronously — taps can land
  // faster than a re-render, so refs are the source of truth for logic and
  // React state is the render mirror.
  const sessionRef = useRef(session)
  const puzzleRef = useRef(puzzle)
  const phaseRef = useRef(phase)
  const stickerKeyRef = useRef(0)

  // Two timer channels: "flow" (round sequencing) is cleared whenever a new
  // round starts; "fx" (jingle notes, particle cleanup) must outlive round
  // resets and is cleared only on unmount.
  const flowTimers = useRef<number[]>([])
  const fxTimers = useRef<number[]>([])
  const cardEls = useRef<(HTMLButtonElement | null)[]>([])
  const roomEl = useRef<HTMLDivElement>(null)
  const particleLayer = useRef<HTMLDivElement>(null)

  const scheduleFlow = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      flowTimers.current = flowTimers.current.filter((t) => t !== id)
      fn()
    }, ms)
    flowTimers.current.push(id)
  }

  const scheduleFx = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      fxTimers.current = fxTimers.current.filter((t) => t !== id)
      fn()
    }, ms)
    fxTimers.current.push(id)
  }

  const clearFlowTimers = () => {
    for (const id of flowTimers.current) window.clearTimeout(id)
    flowTimers.current = []
  }

  useEffect(
    () => () => {
      for (const id of fxTimers.current) window.clearTimeout(id)
    },
    [],
  )

  // Standardized HUD badge: +1 per solved round (a reward counter, like
  // every game). The adaptive L1-L5 ladder stays invisible — difficulty is
  // never shown to the child.
  useEffect(() => reportLevel(session.roundsCompleted + 1), [session.roundsCompleted])

  const setPhaseNow = (next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }

  const setSessionNow = (next: SessionState) => {
    sessionRef.current = next
    setSession(next)
  }

  const setPuzzleNow = (next: Puzzle) => {
    puzzleRef.current = next
    setPuzzle(next)
  }

  /** Round intro: cards drop in staggered; a soft pop as each one lands. */
  useEffect(() => {
    setPhaseNow('intro')
    POP_NOTES.forEach((freq, i) => {
      scheduleFlow(() => playTone(freq, 70, 'sine', 0.05), DROP_MS - 220 + i * DROP_STAGGER_MS)
    })
    scheduleFlow(() => setPhaseNow('play'), INTRO_MS)
    return clearFlowTimers
  }, [round])

  /** Confetti burst from the solved card, in the palette accents. */
  const spawnConfetti = (index: number) => {
    const layer = particleLayer.current
    const room = roomEl.current
    const card = cardEls.current[index]
    if (!layer || !room || !card) return
    const roomRect = room.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const x = cardRect.left + cardRect.width / 2 - roomRect.left
    const y = cardRect.top + cardRect.height / 2 - roomRect.top
    const burst = document.createElement('div')
    burst.className = 'burst'
    for (let i = 0; i < 30; i++) {
      const piece = document.createElement('span')
      piece.className = 'particle'
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
      piece.style.left = `${Math.round(x)}px`
      piece.style.top = `${Math.round(y)}px`
      piece.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 34}vmin`)
      piece.style.setProperty('--dy', `${-(16 + Math.random() * 34)}vmin`)
      piece.style.setProperty('--rot', `${Math.round((Math.random() * 2 - 1) * 480)}deg`)
      piece.style.setProperty('--dur', `${Math.round(1400 + Math.random() * 800)}ms`)
      burst.appendChild(piece)
    }
    layer.appendChild(burst)
    scheduleFx(() => burst.remove(), 2400)
  }

  /** Level-up: a quick sparkle wave sweeps the room + a rising run of notes. */
  const spawnSparkleWave = () => {
    const layer = particleLayer.current
    if (!layer) return
    LEVEL_UP_NOTES.forEach((freq, i) => {
      scheduleFx(() => playTone(freq, 110, 'triangle', 0.1), i * 80)
    })
    const wave = document.createElement('div')
    wave.className = 'sparkle-wave'
    for (let i = 0; i < 10; i++) {
      const spark = document.createElement('span')
      spark.className = 'sparkle'
      spark.textContent = '✨'
      spark.style.left = `${5 + Math.random() * 90}%`
      spark.style.top = `${10 + Math.random() * 80}%`
      spark.style.setProperty('--delay', `${Math.round(Math.random() * 450)}ms`)
      wave.appendChild(spark)
    }
    layer.appendChild(wave)
    scheduleFx(() => wave.remove(), 1500)
  }

  /** The 3 matching cards briefly lean toward each other: "we're the same!" */
  const huddleTrio = () => {
    const room = roomEl.current
    if (!room) return
    const indices = puzzleRef.current.items
      .map((_, i) => i)
      .filter((i) => i !== puzzleRef.current.oddIndex)
    const rects = indices.map((i) => cardEls.current[i]?.getBoundingClientRect())
    const known = rects.filter((r): r is DOMRect => r !== undefined)
    if (known.length === 0) return
    const cx = known.reduce((sum, r) => sum + r.left + r.width / 2, 0) / known.length
    const cy = known.reduce((sum, r) => sum + r.top + r.height / 2, 0) / known.length
    playTone(330, 110, 'sine', 0.05)
    indices.forEach((cardIndex, i) => {
      const el = cardEls.current[cardIndex]
      const rect = rects[i]
      if (!el || !rect) return
      const dx = Math.max(-16, Math.min(16, (cx - (rect.left + rect.width / 2)) * 0.12))
      const dy = Math.max(-12, Math.min(12, (cy - (rect.top + rect.height / 2)) * 0.12))
      const lean = dx >= 0 ? 3 : -3
      el.animate(
        [
          { transform: 'translate(0px, 0px) rotate(0deg)' },
          { transform: `translate(${dx}px, ${dy}px) rotate(${lean}deg)`, offset: 0.45 },
          { transform: 'translate(0px, 0px) rotate(0deg)' },
        ],
        { duration: 560, easing: 'ease-in-out' },
      )
    })
  }

  /** Locked-phase taps are never dead: tiny acknowledgement + quiet note. */
  const ackCard = (index: number) => {
    playTone(660, 70, 'sine', 0.04)
    cardEls.current[index]?.animate([{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }], {
      duration: 200,
      easing: 'ease-out',
    })
  }

  const solveRound = (index: number) => {
    setPhaseNow('solved')
    const solved = puzzleRef.current
    const item = solved.items[index]
    // Golden glow pulse on the winning card (WAAPI so it composes with the
    // CSS dance/exit animations, which only touch transform).
    cardEls.current[index]?.animate(
      [
        { boxShadow: '0 6px 0 rgba(61, 58, 75, 0.08), 0 0 0 0 rgba(255, 217, 61, 0)' },
        { boxShadow: '0 6px 0 rgba(61, 58, 75, 0.08), 0 0 46px 16px rgba(255, 217, 61, 0.6)' },
      ],
      { duration: 300, easing: 'ease-out', fill: 'forwards' },
    )
    CHIME_NOTES.forEach((freq, i) => {
      scheduleFx(() => playTone(freq, 160, 'triangle', 0.12), i * 110)
    })
    spawnConfetti(index)
    scheduleFx(() => {
      playTone(1319, 130, 'sine', 0.07)
      stickerKeyRef.current += 1
      const key = stickerKeyRef.current
      setStickers((prev) => [...prev, { key, emoji: item.emoji, name: item.name }])
    }, STICKER_AT_MS)
    scheduleFlow(() => {
      const after = registerSolve(sessionRef.current, solved)
      setSessionNow(after)
      // Every solve passes a level: persist the ladder (survives an abrupt
      // exit) and bank one star (shown on the launcher tile). The sparkle
      // wave is pure animation on its every-5 beat.
      saveSkill(GAME_ID, { cognitive: after.level })
      addStars(GAME_ID)
      if (isCelebrationSolve(after.roundsCompleted)) spawnSparkleWave()
      setPuzzleNow(nextPuzzle(after, Math.random))
      setRound((r) => r + 1)
    }, NEXT_ROUND_MS)
  }

  const missRound = (index: number) => {
    setSessionNow(registerMiss(sessionRef.current))
    // Low soft boop — funny, never a buzzer, never a red flash.
    playTone(233, 140, 'sine', 0.06)
    cardEls.current[index]?.animate(
      [
        { transform: 'translateX(0px)' },
        { transform: 'translateX(8px)' },
        { transform: 'translateX(-8px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(0px)' },
      ],
      { duration: 300, easing: 'ease-in-out' },
    )
    scheduleFx(huddleTrio, HUDDLE_AT_MS)
  }

  const handleCardTap = (index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (phaseRef.current !== 'play') {
      ackCard(index)
      return
    }
    if (index === puzzleRef.current.oddIndex) solveRound(index)
    else missRound(index)
  }

  /** Shelf stickers are toys too: wiggle + boop on tap. */
  const handleStickerTap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    wobble(event.currentTarget)
    playTone(880, 90, 'sine', 0.06)
  }

  /** Background decorations wobble + boop — everything responds. */
  const handleDecorTap = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    wobble(event.currentTarget)
    playTone(330, 100, 'sine', 0.05)
  }

  const handleRoomTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    wobble(event.currentTarget)
    playTone(294, 90, 'sine', 0.04)
  }

  const hintOn = phase === 'play' && showHint(session)

  return (
    <div
      ref={roomEl}
      className={`odd-one-out phase-${phase}`}
      role="group"
      aria-label="Odd one out room"
      onPointerDown={handleRoomTap}
    >
      <div className="blob blob-a" aria-hidden onPointerDown={handleDecorTap} />
      <div className="blob blob-b" aria-hidden onPointerDown={handleDecorTap} />

      <div className="shelf" role="group" aria-label="Sticker shelf">
        {stickers.map((sticker) => (
          <button
            key={sticker.key}
            type="button"
            className="sticker"
            onPointerDown={handleStickerTap}
            aria-label={`${sticker.name} sticker`}
          >
            <span aria-hidden>{sticker.emoji}</span>
          </button>
        ))}
      </div>

      <div className="cards">
        {puzzle.items.map((item, i) => {
          const isOdd = i === puzzle.oddIndex
          const classes = ['card']
          if (phase === 'solved') classes.push(isOdd ? `is-winner exit-${item.exit}` : 'is-clap')
          if (hintOn && !isOdd) classes.push('is-match')
          if (puzzle.dimension === 'size') classes.push(`shows-${item.size}`)
          return (
            <button
              key={`${round}-${i}`}
              ref={(el) => {
                cardEls.current[i] = el
              }}
              type="button"
              className={classes.join(' ')}
              onPointerDown={handleCardTap(i)}
              aria-label={item.name}
            >
              <span className="card-face" aria-hidden>
                {item.emoji}
              </span>
            </button>
          )
        })}
      </div>

      <div className="particle-layer" ref={particleLayer} aria-hidden />
    </div>
  )
}

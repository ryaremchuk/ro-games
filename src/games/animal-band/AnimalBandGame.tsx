import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { playTone } from '../../shared/audio'
import { reportLevel } from '../../shared/level'
import {
  PAD_PITCHES,
  applyFail,
  applySuccess,
  bandForRounds,
  celebrationTier,
  checkTap,
  initialBandState,
  levelForLength,
} from './logic'
import type { BandState, CelebrationTier } from './logic'
import './AnimalBandGame.css'

/**
 * Game phases (event-granularity React state — sequencing runs on setTimeout
 * chains held in refs, never per-frame state):
 * - attract: idle bounce, waiting for the first touch (also unlocks audio).
 * - playback: the band plays the sequence; input "locked" (taps = quiet note).
 * - echo: child repeats the sequence by tapping pads.
 * - wrong: brief giggle beat before the same sequence replays slower.
 * - celebrate: confetti + arpeggio (taps still make music).
 * - jam: 3s+ free-play window before the next round.
 */
type Phase = 'attract' | 'playback' | 'echo' | 'wrong' | 'celebrate' | 'jam'

const STEP_MS = 550
const GAP_MS = 250
const SLOW_STEP_MS = 700
const SLOW_GAP_MS = 300
const PRE_PLAYBACK_MS = 650
const REPLAY_DELAY_MS = 1000
const CHEER_MS = 1700
const STARS_MS = 2500
const JAM_MS = 3000
const IDLE_MS = 1300
const IDLE_POLL_MS = 350

const CHEER_NOTES = [523, 659, 784, 1047]
const STAR_NOTES = [523, 587, 659, 784, 880, 1047, 1319]
const CONFETTI_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF8FAB', '#4ECDC4']

/**
 * One-shot tap feedback runs through the Web Animations API rather than CSS
 * classes: WAAPI animations survive React className updates (lit/hint classes
 * re-render the pads) and restart naturally on every call.
 */
const CHUNKY_SHADOW = '0 7px 0 rgba(0, 0, 0, 0.2), 0 14px 26px rgba(0, 0, 0, 0.28)'

const PAD_FX: Record<'flash' | 'wrong' | 'tapped', [Keyframe[], KeyframeAnimationOptions]> = {
  // Correct tap / free-jam tap: quick joyful pop with a white glow.
  flash: [
    [
      {
        transform: 'scale(0.92)',
        filter: 'brightness(1.35)',
        boxShadow: `${CHUNKY_SHADOW}, 0 0 42px 10px rgba(255, 255, 255, 0.55)`,
      },
      { transform: 'scale(1.09)', filter: 'brightness(1.2)', offset: 0.55 },
      {
        transform: 'scale(1)',
        filter: 'brightness(1)',
        boxShadow: `${CHUNKY_SHADOW}, 0 0 0 0 rgba(255, 255, 255, 0)`,
      },
    ],
    { duration: 340, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  ],
  // Wrong tap: the animal giggles and wobbles — funny, never a buzzer.
  wrong: [
    [
      { transform: 'rotate(0deg) translateX(0px)' },
      { transform: 'rotate(5deg) translateX(8px)' },
      { transform: 'rotate(-5deg) translateX(-8px)' },
      { transform: 'rotate(4deg) translateX(6px)' },
      { transform: 'rotate(-3deg) translateX(-5px)' },
      { transform: 'rotate(2deg) translateX(3px)' },
      { transform: 'rotate(0deg) translateX(0px)' },
    ],
    { duration: 480, easing: 'ease-in-out' },
  ],
  // Locked-phase stray tap: tiny quiet acknowledgement, never dead.
  tapped: [
    [{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }],
    { duration: 200, easing: 'ease-out' },
  ],
}

/** Decorations (and the whole stage) wiggle when poked. */
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

export default function AnimalBandGame() {
  const [band, setBand] = useState<BandState>(() => initialBandState(Math.random))
  const [phase, setPhase] = useState<Phase>('attract')
  const [progress, setProgress] = useState(0)
  const [litPad, setLitPad] = useState<number | null>(null)

  // Refs mirror the state the timer/tap handlers need synchronously — taps
  // can land faster than a re-render, so refs are the source of truth and
  // React state is the render mirror.
  const bandRef = useRef(band)
  const phaseRef = useRef(phase)
  const progressRef = useRef(progress)
  const lastTapAtRef = useRef(0)
  const jamStartedAtRef = useRef(0)

  // Two timer channels: "flow" (sequence steps, phase changes, idle polling)
  // is cancelled whenever a new playback starts; "fx" (jingle notes, particle
  // cleanup) must outlive flow resets and is cleared only on unmount.
  const flowTimers = useRef<number[]>([])
  const fxTimers = useRef<number[]>([])
  const padEls = useRef<(HTMLButtonElement | null)[]>([])
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
      for (const id of flowTimers.current) window.clearTimeout(id)
      for (const id of fxTimers.current) window.clearTimeout(id)
    },
    [],
  )

  const setPhaseNow = (next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }

  const setProgressNow = (next: number) => {
    progressRef.current = next
    setProgress(next)
  }

  const setBandNow = (next: BandState) => {
    bandRef.current = next
    setBand(next)
  }

  // Standardized HUD badge mirrors the sequence length (the real difficulty).
  useEffect(() => reportLevel(levelForLength(band.sequence.length)), [band.sequence.length])

  const animals = bandForRounds(band.roundsCompleted)

  /** The band performs the current sequence; then it's the child's turn. */
  const startPlayback = (slow: boolean) => {
    clearFlowTimers()
    setPhaseNow('playback')
    setProgressNow(0)
    setLitPad(null)
    const sequence = bandRef.current.sequence
    const step = slow ? SLOW_STEP_MS : STEP_MS
    const gap = slow ? SLOW_GAP_MS : GAP_MS
    sequence.forEach((pad, i) => {
      const at = PRE_PLAYBACK_MS + i * (step + gap)
      scheduleFlow(() => {
        setLitPad(pad)
        // Pitch is tied to pad position (see logic.ts), band rotation aside.
        playTone(PAD_PITCHES[pad], step - 80, 'triangle', 0.14)
      }, at)
      scheduleFlow(() => setLitPad(null), at + step)
    })
    scheduleFlow(
      () => {
        setPhaseNow('echo')
        // "Your turn" cue: pulsing spotlight (CSS, keyed off phase-echo)
        // plus a soft two-note rising chirp — audio+visual redundancy.
        playTone(784, 90, 'sine', 0.07)
        scheduleFx(() => playTone(1047, 130, 'sine', 0.07), 110)
      },
      PRE_PLAYBACK_MS + sequence.length * (step + gap) + 250,
    )
  }

  const enterJam = () => {
    setPhaseNow('jam')
    jamStartedAtRef.current = performance.now()
    pollForNextRound()
  }

  /** Next playback starts on the first idle moment after the jam window. */
  const pollForNextRound = () => {
    scheduleFlow(() => {
      if (phaseRef.current !== 'jam') return
      const now = performance.now()
      if (now - jamStartedAtRef.current >= JAM_MS && now - lastTapAtRef.current >= IDLE_MS) {
        startPlayback(false)
      } else {
        pollForNextRound()
      }
    }, IDLE_POLL_MS)
  }

  const spawnConfetti = (tier: CelebrationTier) => {
    const layer = particleLayer.current
    if (!layer) return
    const burst = document.createElement('div')
    burst.className = 'burst'
    const count = tier === 'stars' ? 72 : 42
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span')
      const star = tier === 'stars' && i % 3 === 0
      piece.className = star ? 'particle particle-star' : 'particle'
      if (star) piece.textContent = '⭐'
      else piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
      piece.style.left = `${34 + Math.random() * 32}%`
      piece.style.top = '58%'
      piece.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 42}vmin`)
      piece.style.setProperty('--dy', `${-(22 + Math.random() * 46)}vmin`)
      piece.style.setProperty('--rot', `${Math.round((Math.random() * 2 - 1) * 540)}deg`)
      piece.style.setProperty('--dur', `${Math.round(1500 + Math.random() * 900)}ms`)
      burst.appendChild(piece)
    }
    layer.appendChild(burst)
    scheduleFx(() => burst.remove(), 2600)
  }

  /** A floating music note rises from the tapped pad during free play. */
  const spawnNote = (pad: number) => {
    const el = padEls.current[pad]
    if (!el) return
    const note = document.createElement('span')
    note.className = 'jam-note'
    note.textContent = Math.random() < 0.5 ? '🎵' : '🎶'
    note.setAttribute('aria-hidden', 'true')
    note.style.setProperty('--drift', `${Math.round((Math.random() * 2 - 1) * 40)}px`)
    el.appendChild(note)
    scheduleFx(() => note.remove(), 1300)
  }

  const celebrate = (tier: CelebrationTier) => {
    const notes = tier === 'stars' ? STAR_NOTES : CHEER_NOTES
    notes.forEach((freq, i) => {
      scheduleFx(() => playTone(freq, 170, 'triangle', 0.13), i * 120)
    })
    spawnConfetti(tier)
  }

  const padFx = (pad: number, kind: keyof typeof PAD_FX) => {
    const el = padEls.current[pad]
    if (el) el.animate(...PAD_FX[kind])
  }

  const handlePadTap = (pad: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    lastTapAtRef.current = performance.now()
    const current = phaseRef.current
    const pitch = animals[pad].pitch

    if (current === 'playback' || current === 'wrong') {
      // Input is "locked" but a pad is never dead — quiet note + tiny ack.
      playTone(pitch, 90, 'sine', 0.04)
      padFx(pad, 'tapped')
      return
    }

    if (current === 'attract') {
      // First touch wakes the band: jam a little, then the round begins.
      playTone(pitch, 200, 'triangle', 0.12)
      padFx(pad, 'flash')
      spawnNote(pad)
      enterJam()
      return
    }

    if (current === 'jam' || current === 'celebrate') {
      playTone(pitch, 200, 'triangle', 0.12)
      padFx(pad, 'flash')
      spawnNote(pad)
      return
    }

    // Echo phase: every tap plays the note, then gets checked.
    playTone(pitch, 260, 'triangle', 0.14)
    const result = checkTap(bandRef.current.sequence, progressRef.current, pad)

    if (result === 'wrong') {
      padFx(pad, 'wrong')
      // Two quick low soft tones — funny, never a buzzer.
      playTone(240, 110, 'sine', 0.07)
      scheduleFx(() => playTone(200, 150, 'sine', 0.07), 130)
      setBandNow(applyFail(bandRef.current))
      setPhaseNow('wrong')
      scheduleFlow(() => startPlayback(true), REPLAY_DELAY_MS)
      return
    }

    padFx(pad, 'flash')
    if (result === 'correct') {
      setProgressNow(progressRef.current + 1)
      return
    }

    // Full echo correct!
    const echoedLength = bandRef.current.sequence.length
    const tier = celebrationTier(echoedLength)
    celebrate(tier)
    setBandNow(applySuccess(bandRef.current, Math.random))
    setPhaseNow('celebrate')
    scheduleFlow(() => enterJam(), tier === 'stars' ? STARS_MS : CHEER_MS)
  }

  /** Decorations (curtains, spotlight, backdrop) wobble + boop when tapped. */
  const handleDecorTap = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    lastTapAtRef.current = performance.now()
    wobble(event.currentTarget)
    playTone(330, 100, 'sine', 0.06)
    if (phaseRef.current === 'attract') enterJam()
  }

  const handlePlayTap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    lastTapAtRef.current = performance.now()
    const current = phaseRef.current
    if (current !== 'jam' && current !== 'attract') return
    playTone(659, 120, 'triangle', 0.1)
    startPlayback(false)
  }

  const hintPad = phase === 'echo' && band.hints ? band.sequence[progress] : null
  const showPlayBlob = phase === 'jam' || phase === 'attract'

  return (
    <div
      className={`animal-band phase-${phase}`}
      role="group"
      aria-label="Animal band stage"
      onPointerDown={handleDecorTap}
    >
      <div className="spotlight" aria-hidden onPointerDown={handleDecorTap} />
      <div className="curtain curtain-top" aria-hidden onPointerDown={handleDecorTap} />
      <div className="curtain curtain-left" aria-hidden onPointerDown={handleDecorTap} />
      <div className="curtain curtain-right" aria-hidden onPointerDown={handleDecorTap} />

      <div className="pads">
        {animals.map((animal, pad) => (
          <button
            key={animal.id}
            ref={(el) => {
              padEls.current[pad] = el
            }}
            type="button"
            className={`pad${litPad === pad ? ' is-lit' : ''}${hintPad === pad ? ' is-hint' : ''}`}
            style={{ backgroundColor: animal.color }}
            onPointerDown={handlePadTap(pad)}
            aria-label={`${animal.name} drum pad`}
          >
            <span className="pad-face" aria-hidden>
              {animal.emoji}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`play-blob${showPlayBlob ? '' : ' is-hidden'}`}
        onPointerDown={handlePlayTap}
        aria-label="Start the next round"
      >
        <svg viewBox="0 0 48 48" aria-hidden focusable="false">
          <path
            d="M19 15.5 Q19 13 21.2 14.2 L33.5 21.8 Q36 23.3 33.5 24.9 L21.2 32.5 Q19 33.7 19 31.2 Z"
            fill="#ffffff"
          />
        </svg>
      </button>

      <div className="particle-layer" ref={particleLayer} aria-hidden />
    </div>
  )
}

import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { unlockAudio } from './audio'
import { clearLevel, getLevel, subscribeLevel } from './level'
import './GameFrame.css'

interface GameFrameProps {
  title: string
  children: ReactNode
}

/**
 * Shared chrome around every game: a full-bleed surface plus a persistent
 * "home" button and the standardized level badge (top-left, next to home —
 * games report their level via shared/level.ts), and it unlocks audio on the
 * first user gesture (required by iOS). Games render into the surface and
 * otherwise stay isolated.
 */
export default function GameFrame({ title, children }: GameFrameProps) {
  const navigate = useNavigate()
  const level = useSyncExternalStore(subscribeLevel, getLevel)

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      clearLevel() // next game starts with a hidden badge until it reports
    }
  }, [])

  return (
    <div className="game-frame">
      <div className="game-surface" role="application" aria-label={title}>
        {children}
      </div>
      <button
        type="button"
        className="home-button"
        onClick={() => navigate('/')}
        aria-label="Back to home"
      >
        <span aria-hidden>🏠</span>
      </button>
      {level !== null && (
        <div key={level} className="level-badge" aria-label={`Level ${level}`}>
          <span className="level-badge-star" aria-hidden>
            ⭐
          </span>
          <span className="level-badge-number" aria-hidden>
            {level}
          </span>
        </div>
      )}
    </div>
  )
}

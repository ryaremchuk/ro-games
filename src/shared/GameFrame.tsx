import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { unlockAudio } from './audio'
import './GameFrame.css'

interface GameFrameProps {
  title: string
  children: ReactNode
}

/**
 * Shared chrome around every game: a full-bleed surface plus a persistent
 * "home" button, and it unlocks audio on the first user gesture (required by
 * iOS). Games render into the surface and otherwise stay isolated.
 */
export default function GameFrame({ title, children }: GameFrameProps) {
  const navigate = useNavigate()

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
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
    </div>
  )
}

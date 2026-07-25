import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { unlockAudio } from './audio'
import { setLevelHidden, subscribeLevel, visibleLevel } from './level'
import './GameFrame.css'

interface GameFrameProps {
  title: string
  /**
   * The game's registry id. Present for leveled games — it drives the shared
   * level badge (top-left, next to home; shared/level.ts — level = stars + 1,
   * the SAME number the launcher tile shows). Omitted for free-play games and
   * non-game routes (e.g. viewport debug), which carry no badge.
   */
  gameId?: string
  children: ReactNode
}

/**
 * Shared chrome around every game: a full-bleed surface plus a persistent
 * "home" button and the standardized level badge, and it unlocks audio on the
 * first user gesture (required by iOS). Games render into the surface and
 * otherwise stay isolated — the badge derives itself from the game's saved
 * stars, so a game never reports its level; it just plays and banks stars.
 */
export default function GameFrame({ title, gameId, children }: GameFrameProps) {
  const navigate = useNavigate()

  const subscribe = useCallback(
    (onChange: () => void) => (gameId ? subscribeLevel(gameId, onChange) : () => {}),
    [gameId],
  )
  const getSnapshot = useCallback(() => (gameId ? visibleLevel(gameId) : null), [gameId])
  const level = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // Each game mounts with the badge visible; special modes (e.g. slingshot's
  // authoring editor) hide it themselves. Reset on mount/unmount so one game's
  // suppression can never leak into the next.
  useEffect(() => {
    setLevelHidden(false)
    return () => setLevelHidden(false)
  }, [gameId])

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

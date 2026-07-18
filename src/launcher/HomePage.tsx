import { useRef } from 'react'
import type React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { games } from '../games/registry'
import { getStars } from '../shared/progress'
import './HomePage.css'

/** Picture-only launcher: one big tile per game (a 3-4yo can't read yet). */
export default function HomePage() {
  const navigate = useNavigate()
  // Hidden adult entrance to #/viewport-debug: 7 fast taps on the launcher
  // BACKGROUND (tiles don't count). Standalone PWAs have no address bar, so a
  // gesture is the only way to reach diagnostics on the installed app.
  const taps = useRef<number[]>([])
  const onBackgroundTap = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return
    const now = performance.now()
    taps.current = [...taps.current.filter((t) => now - t < 3000), now]
    if (taps.current.length >= 7) {
      taps.current = []
      navigate('/viewport-debug')
    }
  }
  // 3 tiles per row; the CSS uses the row count to shrink tiles until every
  // row fits on screen (the launcher must never scroll).
  const rows = Math.ceil(games.length / 3)
  return (
    <main className="home" onPointerDown={onBackgroundTap}>
      <div className="home-grid" style={{ '--rows': rows } as React.CSSProperties}>
        {games.map((game) => {
          // Persistent reward stars (shared/progress.ts) — the one number
          // that only ever grows; fresh on every visit since navigating
          // back home remounts this page.
          const stars = getStars(game.id)
          return (
            <Link
              key={game.id}
              to={game.path}
              className="home-tile"
              style={{ backgroundColor: game.color }}
              aria-label={stars > 0 ? `${game.title}, ${stars} stars earned` : game.title}
            >
              <span className="home-tile-emoji" aria-hidden>
                {game.emoji}
              </span>
              {stars > 0 && (
                <span className="home-tile-stars" aria-hidden>
                  <span className="home-tile-stars-icon">⭐</span>
                  {stars}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </main>
  )
}

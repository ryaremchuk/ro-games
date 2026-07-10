import type React from 'react'
import { Link } from 'react-router-dom'
import { games } from '../games/registry'
import './HomePage.css'

/** Picture-only launcher: one big tile per game (a 3-4yo can't read yet). */
export default function HomePage() {
  // 3 tiles per row; the CSS uses the row count to shrink tiles until every
  // row fits on screen (the launcher must never scroll).
  const rows = Math.ceil(games.length / 3)
  return (
    <main className="home">
      <div className="home-grid" style={{ '--rows': rows } as React.CSSProperties}>
        {games.map((game) => (
          <Link
            key={game.id}
            to={game.path}
            className="home-tile"
            style={{ backgroundColor: game.color }}
            aria-label={game.title}
          >
            <span className="home-tile-emoji" aria-hidden>
              {game.emoji}
            </span>
          </Link>
        ))}
      </div>
    </main>
  )
}

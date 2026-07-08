import { Link } from 'react-router-dom'
import { games } from '../games/registry'
import './HomePage.css'

/** Picture-only launcher: one big tile per game (a 3-4yo can't read yet). */
export default function HomePage() {
  return (
    <main className="home">
      <div className="home-grid">
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

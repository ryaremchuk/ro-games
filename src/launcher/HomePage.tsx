import { useRef } from 'react'
import type React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { games } from '../games/registry'
import { levelFor } from '../shared/level'
import './HomePage.css'

// Every launcher image as a hashed, base-aware URL — same idiom the games use
// for their sprite art (see memory/art.ts). Covers are `cover-<game.id>.webp`.
const ART_URLS = import.meta.glob('./art/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
function art(name: string): string {
  const url = ART_URLS[`./art/${name}.webp`]
  if (!url) throw new Error(`launcher: missing art "${name}"`)
  return url
}

// Purely decorative beach critters that wander behind the tiles. Each is a
// 2-frame walk cycle (frames flip in CSS). `dir` 1 = travels left→right, -1 =
// right→left; `rot` faces the head-up sprite along its path. `fly` swaps the
// ground crawl for a drifting up/down path.
interface Crawler {
  frames: [string, string]
  top: string
  size: number // vmin
  dur: number // seconds for one crossing
  delay: number
  dir: 1 | -1
  rot: number
  fly?: boolean
}
const CRAWLERS: Crawler[] = [
  { frames: ['ladybug-1', 'ladybug-2'], top: '7%', size: 7, dur: 42, delay: -4, dir: 1, rot: 90 },
  { frames: ['ant-1', 'ant-2'], top: '85%', size: 5.5, dur: 31, delay: -13, dir: 1, rot: 90 },
  { frames: ['snail-1', 'snail-2'], top: '88%', size: 8, dur: 72, delay: -26, dir: 1, rot: 0 },
  {
    frames: ['butterfly-1', 'butterfly-2'],
    top: '11%',
    size: 8,
    dur: 27,
    delay: -6,
    dir: -1,
    rot: 0,
    fly: true,
  },
  {
    frames: ['butterfly-1', 'butterfly-2'],
    top: '20%',
    size: 6,
    dur: 34,
    delay: -17,
    dir: 1,
    rot: 0,
    fly: true,
  },
]

// Static props tucked into the margins around the grid (behind the tiles).
interface Prop {
  name: string
  style: React.CSSProperties
}
const PROPS: Prop[] = [
  { name: 'sandcastle', style: { left: '1%', bottom: '0.5%', width: '19vmin' } },
  { name: 'bucket', style: { right: '2%', bottom: '1%', width: '13vmin' } },
  {
    name: 'shovel',
    style: { right: '13%', bottom: '0.5%', width: '10vmin', transform: 'rotate(20deg)' },
  },
  {
    name: 'starfish',
    style: { left: '2%', top: '2%', width: '11vmin', transform: 'rotate(-12deg)' },
  },
  { name: 'shell-spiral', style: { right: '3%', top: '3%', width: '9vmin' } },
  { name: 'shell-fan', style: { left: '16%', bottom: '1%', width: '8vmin' } },
  { name: 'pebbles', style: { left: '38%', bottom: '0.5%', width: '9vmin' } },
  { name: 'leaf', style: { right: '1%', top: '34%', width: '8vmin', transform: 'rotate(-18deg)' } },
]

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
  // The dice tile is a "surprise me" button: jumps straight into a random game.
  const surprise = () => {
    const game = games[Math.floor(Math.random() * games.length)]
    navigate(game.path)
  }
  // 3 tiles per row. With the dice surprise tile the grid is a full 3×3 (8
  // games + dice). The CSS uses the row count to shrink tiles so every row
  // fits on screen (the launcher must never scroll).
  const rows = Math.ceil((games.length + 1) / 3)
  return (
    <main className="home" onPointerDown={onBackgroundTap}>
      <div className="home-deco" aria-hidden>
        {PROPS.map((p) => (
          <img key={p.name} className="home-prop" style={p.style} src={art(p.name)} alt="" />
        ))}
        {CRAWLERS.map((c, i) => (
          <div
            key={i}
            className={c.fly ? 'home-crawler home-crawler--fly' : 'home-crawler'}
            data-dir={c.dir}
            style={
              {
                top: c.top,
                width: `${c.size}vmin`,
                '--dur': `${c.dur}s`,
                '--delay': `${c.delay}s`,
                '--rot': `${c.rot}deg`,
              } as React.CSSProperties
            }
          >
            <img src={art(c.frames[0])} alt="" />
            <img src={art(c.frames[1])} alt="" />
          </div>
        ))}
      </div>

      <div className="home-grid" style={{ '--rows': rows } as React.CSSProperties}>
        {games.map((game) => {
          // The SAME level the in-game badge shows (shared/level.ts —
          // level = stars + 1). Shown once the child has passed a level
          // (level > 1) so a fresh launcher stays uncluttered; free-play
          // games (no `leveled`) never carry it. Fresh on every visit since
          // navigating back home remounts this page.
          const level = game.leveled ? levelFor(game.id) : 1
          const showLevel = game.leveled && level > 1
          return (
            <Link
              key={game.id}
              to={game.path}
              className="home-tile"
              aria-label={showLevel ? `${game.title}, level ${level}` : game.title}
            >
              <img className="home-tile-cover" src={art(`cover-${game.id}`)} alt="" aria-hidden />
              {showLevel && (
                <span className="home-tile-stars" aria-hidden>
                  <span className="home-tile-stars-icon">⭐</span>
                  {level}
                </span>
              )}
            </Link>
          )
        })}
        <button type="button" className="home-tile" onClick={surprise} aria-label="Surprise game">
          <img className="home-tile-cover" src={art('cover-dice')} alt="" aria-hidden />
        </button>
      </div>
    </main>
  )
}

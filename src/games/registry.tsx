import type { ComponentType, LazyExoticComponent } from 'react'
import { lazyWithReload } from '../shared/lazyWithReload'

export interface GameMeta {
  /** Stable unique id; also the folder name under src/games/. */
  id: string
  /** Human label — used for accessibility, never shown to pre-readers. */
  title: string
  /** Route path under the hash router, e.g. "/drawing". */
  path: string
  /** Launcher tile background color. */
  color: string
  /** Placeholder visual until real art is added. */
  emoji: string
  /** Lazily-loaded game component (code-split per route). */
  component: LazyExoticComponent<ComponentType>
}

/**
 * The single source of truth for which games exist. Add a game here and it
 * automatically gets a launcher tile and a route (see App.tsx). Danger CI
 * fails a PR that adds a src/games/<name>/ folder without updating this file.
 */
export const games: GameMeta[] = [
  {
    id: 'drawing',
    title: 'Drawing',
    path: '/drawing',
    color: '#ff6b6b',
    emoji: '🖍️',
    component: lazyWithReload(() => import('./drawing/DrawingGame')),
  },
  {
    id: 'feed-the-monster',
    title: 'Feed the Monster',
    path: '/feed-the-monster',
    color: '#FFA94D',
    emoji: '👾',
    component: lazyWithReload(() => import('./feed-the-monster/FeedTheMonsterGame')),
  },
  {
    id: 'animal-band',
    title: 'Animal Band',
    path: '/animal-band',
    color: '#9B5DE5',
    emoji: '🥁',
    component: lazyWithReload(() => import('./animal-band/AnimalBandGame')),
  },
  {
    id: 'whack-a-silly',
    title: 'Whack-a-Silly',
    path: '/whack-a-silly',
    color: '#6BCB77',
    emoji: '🐹',
    component: lazyWithReload(() => import('./whack-a-silly/WhackASillyGame')),
  },
  {
    id: 'odd-one-out',
    title: 'Odd One Out',
    path: '/odd-one-out',
    color: '#4ECDC4',
    emoji: '🧩',
    component: lazyWithReload(() => import('./odd-one-out/OddOneOutGame')),
  },
  {
    id: 'balloon-pop',
    title: 'Balloon Pop',
    path: '/balloon-pop',
    color: '#4D96FF',
    emoji: '🎈',
    component: lazyWithReload(() => import('./balloon-pop/BalloonPopGame')),
  },
  {
    id: 'slingshot',
    title: 'Slingshot Birds',
    path: '/slingshot',
    color: '#FFD93D',
    emoji: '🐦',
    component: lazyWithReload(() => import('./slingshot/SlingshotGame')),
  },
  {
    id: 'memory',
    title: 'Memory',
    path: '/memory',
    color: '#FF8FAB',
    emoji: '🐾',
    component: lazyWithReload(() => import('./memory/MemoryGame')),
  },
]

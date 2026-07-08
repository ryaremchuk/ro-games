import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'

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
    component: lazy(() => import('./drawing/DrawingGame')),
  },
]

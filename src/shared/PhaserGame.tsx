import { useEffect, useRef } from 'react'
import Phaser from 'phaser'

interface PhaserGameProps {
  /** Phaser config; the `parent` container is injected automatically. */
  config: Omit<Phaser.Types.Core.GameConfig, 'parent'>
  /**
   * Called once with the created game, for the rare surface that needs to talk
   * to its scene from the DOM side — e.g. Feed the Monster mounting the shared
   * pixel pad over the running canvas when the scene commissions a drawing.
   * Captured on mount like `config`.
   */
  onReady?: (game: Phaser.Game) => void
}

/**
 * Reusable mount point for a Phaser game. Creates the Phaser.Game on mount and
 * destroys it on unmount, filling the GameFrame surface. Import this from any
 * game that needs a real engine (movement, sprites, physics, particles).
 *
 * Because it imports Phaser, only routes that use it pull Phaser into their
 * lazily-loaded chunk — the launcher and Canvas-only games stay lightweight.
 *
 * The `config` is captured once on mount by design; to rebuild with a new
 * config, remount this component via a React `key`.
 */
export default function PhaserGame({ config, onReady }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return
    gameRef.current = new Phaser.Game({
      ...config,
      parent: containerRef.current,
    })
    onReady?.(gameRef.current)
    return () => {
      gameRef.current?.destroy(true)
      gameRef.current = null
    }
    // Mount-only: the config is intentionally captured once. Remount via `key`
    // (rather than mutating config) to rebuild the game.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef} className="phaser-game" style={{ width: '100%', height: '100%' }} />
  )
}

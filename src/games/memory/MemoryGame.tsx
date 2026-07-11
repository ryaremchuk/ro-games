import Phaser from 'phaser'
import PhaserGame from '../../shared/PhaserGame'
import { viewportSize } from '../../shared/viewport'
import MemoryScene from './MemoryScene'

/**
 * Memory — a classic card-matching game with a calm pastel scene and
 * Paw-Patrol-inspired original chibi art. Tap two cards; matching pairs stay up
 * and celebrate, mismatches flip back after a learning hold, and clearing the
 * board auto-advances to a bigger level. No timers, no scores, no fail states.
 *
 * Hi-DPI: the canvas is backed at physical pixels (css × dpr) and scaled down
 * via zoom so the vector card art stays crisp on retina iPads. The scene
 * relayouts itself on window resize / orientation change.
 */
export default function MemoryGame() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const vp = viewportSize()
  const config: Omit<Phaser.Types.Core.GameConfig, 'parent'> = {
    type: Phaser.AUTO,
    backgroundColor: '#BBE3F5',
    scale: {
      mode: Phaser.Scale.NONE,
      width: vp.width * dpr,
      height: vp.height * dpr,
      zoom: 1 / dpr,
    },
    scene: [MemoryScene],
  }

  return (
    <div
      role="img"
      aria-label="Flip the cards and find the matching pairs"
      style={{ width: '100%', height: '100%' }}
    >
      <PhaserGame config={config} />
    </div>
  )
}

import Phaser from 'phaser'
import PhaserGame from '../../shared/PhaserGame'
import FeedTheMonsterScene from './FeedTheMonsterScene'

/**
 * Feed the Monster — a hungry blob shows what it wants as pictures in a
 * thought bubble; the child drags foods from the tray into its mouth.
 * Phaser-rendered; all round/request logic lives in logic.ts (pure, tested).
 *
 * Hi-DPI: the canvas is backed at physical pixels (css × dpr) and scaled
 * down via zoom so emoji textures and vector art stay crisp on retina iPads.
 * The scene relayouts itself on window resize/orientation change.
 */
export default function FeedTheMonsterGame() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const config: Omit<Phaser.Types.Core.GameConfig, 'parent'> = {
    type: Phaser.AUTO,
    backgroundColor: '#FFE8CC',
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.max(window.innerWidth, 1) * dpr,
      height: Math.max(window.innerHeight, 1) * dpr,
      zoom: 1 / dpr,
    },
    scene: [FeedTheMonsterScene],
  }

  return (
    <div
      role="img"
      aria-label="Feed the monster by dragging food from the tray into its mouth"
      style={{ width: '100%', height: '100%' }}
    >
      <PhaserGame config={config} />
    </div>
  )
}

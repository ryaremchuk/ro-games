import Phaser from 'phaser'
import PhaserGame from '../../shared/PhaserGame'
import { viewportSize } from '../../shared/viewport'
import WhackASillyScene from './WhackASillyScene'

/**
 * Whack-a-Silly — garden whack-a-mole with a go/no-go inhibition twist:
 * bop the critters popping out of the dirt mounds, but sleeping critters
 * (in nightcaps) must be left alone (letting one nap in peace is celebrated).
 * Phaser-rendered; all spawn-scheduling/ramp logic lives in logic.ts
 * (pure, tested).
 *
 * Hi-DPI: the canvas is backed at physical pixels (css × dpr) and scaled
 * down via zoom so emoji textures and vector art stay crisp on retina iPads.
 * The scene relayouts itself on window resize/orientation change.
 */
export default function WhackASillyGame() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const vp = viewportSize()
  const config: Omit<Phaser.Types.Core.GameConfig, 'parent'> = {
    type: Phaser.AUTO,
    backgroundColor: '#BDE3FF',
    scale: {
      mode: Phaser.Scale.NONE,
      width: vp.width * dpr,
      height: vp.height * dpr,
      zoom: 1 / dpr,
    },
    scene: [WhackASillyScene],
  }

  return (
    <div
      role="img"
      aria-label="Bop the critters popping out of the garden holes, but let the sleeping critters in nightcaps nap in peace"
      style={{ width: '100%', height: '100%' }}
    >
      <PhaserGame config={config} />
    </div>
  )
}

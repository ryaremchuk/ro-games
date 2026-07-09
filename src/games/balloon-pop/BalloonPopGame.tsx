import Phaser from 'phaser'
import PhaserGame from '../../shared/PhaserGame'
import BalloonPopScene from './BalloonPopScene'

/**
 * Balloon Pop — subitizing/counting popper: a crab conductor holds a sign
 * showing a target quantity (big numeral + the same dot pattern + spoken as
 * ascending count beeps); balloons drift up carrying dot patterns (or
 * numerals, late rounds) and the child pops the ones matching the target.
 * Wrong balloons boing and float on — soft error, no penalty. All round
 * generation / difficulty-ramp logic lives in logic.ts (pure, tested).
 *
 * Hi-DPI: the canvas is backed at physical pixels (css × dpr) and scaled
 * down via zoom so the vector art and numerals stay crisp on retina iPads.
 * The scene relayouts itself on window resize/orientation change.
 */
export default function BalloonPopGame() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const config: Omit<Phaser.Types.Core.GameConfig, 'parent'> = {
    type: Phaser.AUTO,
    backgroundColor: '#7CC6FE',
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.max(window.innerWidth, 1) * dpr,
      height: Math.max(window.innerHeight, 1) * dpr,
      zoom: 1 / dpr,
    },
    scene: [BalloonPopScene],
  }

  return (
    <div
      role="img"
      aria-label="Pop the balloons whose dots match the number the crab is holding up"
      style={{ width: '100%', height: '100%' }}
    >
      <PhaserGame config={config} />
    </div>
  )
}

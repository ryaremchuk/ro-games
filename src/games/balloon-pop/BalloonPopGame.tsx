import Phaser from 'phaser'
import PhaserGame from '../../shared/PhaserGame'
import BalloonPopScene from './BalloonPopScene'

/**
 * Balloon Pop — subitizing/counting popper: a crab conductor holds a sign
 * showing the current task in exactly ONE representation (dots, a numeral,
 * or — in color rounds — either of those on a mini balloon of the required
 * color), spoken as ascending count beeps; balloons drift up and the child
 * pops the ones matching the task. A level badge beside the sign counts
 * rainbow celebrations (one level per rainbow, every 5 rounds); level 6+
 * crosses representations (dots sign ↔ numeral balloons) and level 8+ adds
 * color-and-number rounds. Wrong balloons boing and float on — soft error,
 * no penalty. All round generation / difficulty-ramp logic lives in
 * logic.ts (pure, tested).
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
      aria-label="Pop the balloons that match the crab's sign — its dots, number, or balloon color"
      style={{ width: '100%', height: '100%' }}
    >
      <PhaserGame config={config} />
    </div>
  )
}

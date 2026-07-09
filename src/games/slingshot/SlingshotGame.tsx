import Phaser from 'phaser'
import PhaserGame from '../../shared/PhaserGame'
import SlingshotScene from './SlingshotScene'

/**
 * Slingshot Birds — an Angry-Birds-style physics playground for a 3–4 year old.
 * The child drags anywhere on the left half to stretch a slingshot (with a live
 * dotted trajectory preview), releases to launch a round bird at wobbly block
 * towers, and frees sleeping piggies that giggle and float away on balloons.
 * Physics themselves change with the level themes (mass, friction, bounce,
 * levers, moon gravity) so the child *feels* the physics. Unlimited birds
 * auto-reload, an invisible assist guarantees eventual success, and every level
 * ends only in a rainbow celebration — no fail state, no text, no numbers.
 *
 * All movement runs in a Phaser 4 Matter world (never through React state).
 * Hi-DPI: the canvas is backed at physical pixels (css × dpr) and scaled down
 * via zoom so the procedural vector art stays crisp on retina iPads; the scene
 * relayouts (rebuilds the level) on window resize / orientation change and
 * scales every physics tuning by a single resolution unit so the game plays
 * identically across dpr and portrait/landscape.
 */
export default function SlingshotGame() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const config: Omit<Phaser.Types.Core.GameConfig, 'parent'> = {
    type: Phaser.AUTO,
    backgroundColor: '#8fd0ff',
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.max(window.innerWidth, 1) * dpr,
      height: Math.max(window.innerHeight, 1) * dpr,
      zoom: 1 / dpr,
    },
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: 1 },
        enableSleeping: true,
        // Stable stacks + a steady seesaw pivot need extra solver iterations.
        positionIterations: 8,
        velocityIterations: 8,
        constraintIterations: 3,
      },
    },
    scene: [SlingshotScene],
  }

  return (
    <div
      role="img"
      aria-label="Pull the slingshot and launch birds at the block towers to free the sleeping piggies"
      style={{ width: '100%', height: '100%' }}
    >
      <PhaserGame config={config} />
    </div>
  )
}

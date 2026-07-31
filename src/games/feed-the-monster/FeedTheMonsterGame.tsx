import { useCallback, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Phaser from 'phaser'
import { useSearchParams } from 'react-router-dom'
import PhaserGame from '../../shared/PhaserGame'
import { viewportSize } from '../../shared/viewport'
import PixelPad from '../../shared/pixel/PixelPad'
import type { Drawing } from '../../shared/pixel/artStore'
import { COLOR_HEX } from './logic'
import type { FoodColor } from './logic'
import FeedDevPanel from './FeedDevPanel'
import FeedTheMonsterScene from './FeedTheMonsterScene'

/**
 * Feed the Monster — a hungry blob shows what it wants as pictures in a
 * thought bubble; the child drags foods from the tray into its mouth.
 * Phaser-rendered; all round/request logic lives in logic.ts (pure, tested).
 *
 * Hi-DPI: the canvas is backed at physical pixels (css × dpr) and scaled
 * down via zoom so emoji textures and vector art stay crisp on retina iPads.
 * The scene relayouts itself on window resize/orientation change.
 *
 * One thing lives OUTSIDE the canvas: the pixel pad, dressed as an easel. When the
 * scene commissions a food ("draw me something red") the friend asks first, alone
 * on stage, and only then does the scene emit `commission` and the shared `PixelPad`
 * rise over the running game — no route change, no lost game state.
 *
 * The panel leaves the top strip of the screen uncovered. That strip is where the
 * ASK lives (the pencil bubble, which keeps pulsing and chirping while the child
 * draws — see requestBubble.nudgeCommission), not the friend: an easel big enough
 * to draw on and a friend big enough to read do not both fit, so the friend is
 * behind it and the bubble carries the "someone is waiting" signal.
 */

interface Commission {
  color: FoodColor
  /** False below the colour-round unlock, where the ask is "draw anything". */
  askColor: boolean
}

/** Fraction of the screen the pad panel claims; the friend keeps the rest. */
const PAD_TOP_FRAC = 0.2

export default function FeedTheMonsterGame() {
  // `?dev` (e.g. #/feed-the-monster?dev) reveals the developer cheat overlay.
  const [params] = useSearchParams()
  const dev = params.has('dev')
  const e2e = params.has('e2e')

  const sceneRef = useRef<FeedTheMonsterScene | null>(null)
  const [commission, setCommission] = useState<Commission | null>(null)

  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const vp = viewportSize()
  const config: Omit<Phaser.Types.Core.GameConfig, 'parent'> = {
    type: Phaser.AUTO,
    backgroundColor: '#FFE8CC',
    scale: {
      mode: Phaser.Scale.NONE,
      width: vp.width * dpr,
      height: vp.height * dpr,
      zoom: 1 / dpr,
    },
    scene: [FeedTheMonsterScene],
  }

  /**
   * Subscribe to the scene's commission event. The scene boots asynchronously
   * (Phaser), so poll for it rather than assuming it exists at mount — the same
   * shape the dev panel uses for its hook.
   */
  const onReady = useCallback((game: Phaser.Game) => {
    const attach = () => {
      const scene = game.scene.getScene('feed-the-monster') as FeedTheMonsterScene | null
      if (!scene) {
        window.setTimeout(attach, 120)
        return
      }
      sceneRef.current = scene
      scene.events.on('commission', (next: Commission | null) => setCommission(next))
    }
    attach()
  }, [])

  const onDone = useCallback((drawing: Drawing | null) => {
    setCommission(null)
    sceneRef.current?.submitCommission(drawing)
  }, [])

  return (
    <div
      role="img"
      aria-label="Feed the monster by dragging food from the tray into its mouth"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <PhaserGame config={config} onReady={onReady} />
      {commission && (
        <div style={{ ...styles.padPanel, top: `${PAD_TOP_FRAC * 100}%` }}>
          <PixelPad
            role="ftm-food"
            askColor={
              commission.askColor
                ? `#${COLOR_HEX[commission.color].toString(16).padStart(6, '0')}`
                : undefined
            }
            onDone={onDone}
            exposeTestApi={dev || e2e || import.meta.env.DEV}
          />
        </div>
      )}
      {dev && <FeedDevPanel />}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  padPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.28)',
    animation: 'none',
  },
}

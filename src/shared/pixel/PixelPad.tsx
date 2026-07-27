/**
 * The PIXEL PAD — a square grid of fat cells the child paints one at a time.
 *
 * Shared on purpose: the pad is not a game, it is an instrument. The `/drawing`
 * route is a thin studio shell around it, and any game that needs a drawing
 * mounts the same component as an overlay over its running scene (the first such
 * consumer is Feed the Monster's food commission, which opens the pad over a live
 * Phaser canvas with no route change and no lost game state).
 *
 * Implementation notes that matter, all of them learned the hard way in pixel
 * editors:
 *  • The grid IS the bitmap — one `<canvas>` at `size × size` backing pixels,
 *    one pixel per cell, upscaled with `image-rendering: pixelated`. No per-cell
 *    DOM, no hi-DPI maths.
 *  • Bresenham between pointer samples (grid.linePoints): a fast drag reports
 *    only a few samples, and without interpolation the stroke comes out dotted.
 *  • Paint-once per stroke: a finger wandering back over a cell it already
 *    painted does not repaint it, so stroke-level undo is exact and there is no
 *    flicker.
 *  • Paper, not white: an empty cell RENDERS as warm paper and STORES as
 *    transparent (see palette.PAPER) — the child never sees a checkerboard, and
 *    every reuse path still gets correct alpha.
 *  • Grid lines live on a separate overlay canvas so they never contaminate the
 *    data.
 *
 * No-fail rules: nothing is ever lost (a non-blank page is filed to the gallery
 * on done, on clear, and on unmount), there is no wrong pixel and no score, and
 * undo is never greyed into uselessness — an empty stack is simply inert.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { playTone } from '../audio'
import { PALETTE, PAPER, PAPER_HEX, SWATCHES } from './palette'
import {
  DEFAULT_GRID_SIZE,
  cloneGrid,
  createGrid,
  isBlank,
  linePoints,
  paintCell,
  revertEdits,
} from './grid'
import type { CellEdit, Grid, GridSize } from './grid'
import { gridToDrawing, saveDrawing } from './artStore'
import type { Drawing, DrawingRole } from './artStore'
import { cellFromPoint, cellSize, padLayout } from './layout'
import type { PadLayout } from './layout'
import type { PixelPadTestApi } from './testHook'

/** One stroke (pointer-down → up) = one undo step. */
const UNDO_DEPTH = 20
/** A fast drag must not machine-gun the tick sound. */
const TICK_THROTTLE_MS = 40

export interface PixelPadProps {
  /** Grid resolution. 16 is the only size comfortable on every device. */
  size?: GridSize
  /**
   * The colour this pad was commissioned for, as a hex — shown as a blot beside
   * the done button so the ask stays on screen while the child paints. The
   * palette is deliberately NOT restricted to it: taking colours away is the one
   * thing that makes a free-play pad feel like a test.
   */
  askColor?: string
  /** Commission metadata written onto the filed drawing (see artStore). */
  role?: DrawingRole
  tag?: string
  /** Start from an existing drawing (re-opening one from the gallery). */
  initial?: Grid
  /**
   * Handed the filed drawing, or null when the page was left blank. A blank page
   * must cost the child nothing — the caller carries on as if nothing happened.
   */
  onDone: (drawing: Drawing | null) => void
  /** Extra rail content above the tools (the studio's size buttons, gallery). */
  railTop?: ReactNode
  /**
   * How many full-size buttons `railTop` adds. The rail's column count is derived
   * from its item count so nothing is ever clipped (layout.railFits), and it
   * cannot count React children it was handed as opaque nodes.
   */
  railTools?: number
  /**
   * Strip at the top-left the rail must keep clear (the shell's home button and
   * level badge live there). See layout.PadMetrics.chromeTop.
   */
  chromeTop?: number
  /** Label for the done button; defaults to a big check. */
  doneLabel?: string
  /**
   * How the pad is dressed. The default EASEL (wooden frame, ledge, legs) is the
   * house look: the pad opens over a running game, and a bare white square over a
   * live scene reads as a system dialog instead of as a thing in the world.
   * `'plain'` is kept for a consumer that genuinely wants only the instrument.
   */
  frame?: 'easel' | 'plain'
  /** Expose the dev/e2e hook (so a spec can paint real cells). */
  exposeTestApi?: boolean
}

interface Tool {
  color: number
  eraser: boolean
}

export default function PixelPad({
  size = DEFAULT_GRID_SIZE,
  askColor,
  role,
  tag,
  initial,
  onDone,
  railTop,
  railTools = 0,
  chromeTop = 0,
  doneLabel = '✓',
  frame = 'easel',
  exposeTestApi = false,
}: PixelPadProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const paintRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<HTMLCanvasElement>(null)

  const [box, setBox] = useState({ vw: 0, vh: 0 })
  const [tool, setTool] = useState<Tool>({ color: 3, eraser: false })
  const [undoDepth, setUndoDepth] = useState(0)

  // The grid, the in-flight stroke and the undo stack are imperative state: the
  // pointer handlers run at input rate and must never wait on a React render.
  const grid = useRef<Grid>(initial ? cloneGrid(initial) : createGrid(size))
  const stroke = useRef<{
    edits: CellEdit[]
    touched: Set<number>
    last: { x: number; y: number }
  } | null>(null)
  const undoStack = useRef<CellEdit[][]>([])
  const lastTickAt = useRef(0)
  const toolRef = useRef(tool)
  toolRef.current = tool

  const layout: PadLayout = useMemo(
    () =>
      padLayout(
        { vw: box.vw || 1, vh: box.vh || 1, chromeTop },
        // Eraser + undo + bin, plus whatever the shell added.
        { tools: 3 + railTools, swatches: SWATCHES.length },
        frame === 'easel',
      ),
    [box.vw, box.vh, chromeTop, railTools, frame],
  )

  // ─── Rendering ─────────────────────────────────────────────────────────────

  const repaint = useCallback(() => {
    const canvas = paintRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const g = grid.current
    const image = ctx.createImageData(g.w, g.h)
    for (let i = 0; i < g.cells.length; i++) {
      const hex = PALETTE[g.cells[i]] ?? PAPER_HEX
      const value = parseInt(hex.slice(1), 16)
      const at = i * 4
      image.data[at] = (value >> 16) & 0xff
      image.data[at + 1] = (value >> 8) & 0xff
      image.data[at + 2] = value & 0xff
      image.data[at + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  }, [])

  /** Grid lines on their own canvas — data and decoration never mix. */
  const drawGridLines = useCallback(() => {
    const canvas = gridRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || layout.side <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(layout.side * dpr)
    canvas.height = Math.round(layout.side * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, layout.side, layout.side)
    const step = cellSize(layout.side, size)
    ctx.strokeStyle = 'rgba(61, 58, 75, 0.13)'
    ctx.lineWidth = 1
    for (let i = 1; i < size; i++) {
      const at = Math.round(i * step) + 0.5
      ctx.beginPath()
      ctx.moveTo(at, 0)
      ctx.lineTo(at, layout.side)
      ctx.moveTo(0, at)
      ctx.lineTo(layout.side, at)
      ctx.stroke()
    }
  }, [layout.side, size])

  // Track the pad's own box (not the window): the studio fills the screen, the
  // Feed the Monster overlay is a slide-up panel that leaves the friend visible.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setBox({ vw: el.clientWidth, vh: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A size change opens a genuinely fresh page (the caller files the old one —
  // resampling 16→32 would produce art the child did not make).
  useEffect(() => {
    grid.current = initial ? cloneGrid(initial) : createGrid(size)
    undoStack.current = []
    setUndoDepth(0)
    repaint()
  }, [size, initial, repaint])

  useEffect(() => {
    repaint()
  }, [repaint, box.vw, box.vh])

  useEffect(() => {
    drawGridLines()
  }, [drawGridLines])

  // ─── Painting ──────────────────────────────────────────────────────────────

  const tick = useCallback((color: number, eraser: boolean) => {
    const now = performance.now()
    if (now - lastTickAt.current < TICK_THROTTLE_MS) return
    lastTickAt.current = now
    // Pitch steps with the palette index so the pad sounds like a little
    // instrument; the eraser keeps the app's convention of a lower note.
    if (eraser) playTone(196, 45, 'sine', 0.05)
    else playTone(430 + color * 24, 40, 'sine', 0.045)
  }, [])

  const paintAt = useCallback(
    (cx: number, cy: number) => {
      const active = stroke.current
      if (!active) return
      const { color, eraser } = toolRef.current
      const value = eraser ? PAPER : color
      const flat = cy * grid.current.w + cx
      // Paint-once per stroke: no flicker, and stroke-level undo stays exact.
      if (active.touched.has(flat)) return
      active.touched.add(flat)
      if (paintCell(grid.current, cx, cy, value, active.edits)) {
        tick(value, eraser)
      }
    },
    [tick],
  )

  const pointToCell = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
      const rect = paintRef.current!.getBoundingClientRect()
      return cellFromPoint(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        layout.side,
        size,
      )
    },
    [layout.side, size],
  )

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const cell = pointToCell(event)
    stroke.current = { edits: [], touched: new Set(), last: cell }
    paintAt(cell.x, cell.y)
    repaint()
  }

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = stroke.current
    if (!active) return
    event.preventDefault()
    const cell = pointToCell(event)
    if (cell.x === active.last.x && cell.y === active.last.y) return
    for (const point of linePoints(active.last.x, active.last.y, cell.x, cell.y)) {
      paintAt(point.x, point.y)
    }
    active.last = cell
    repaint()
  }

  const handleUp = () => {
    const active = stroke.current
    stroke.current = null
    if (!active || active.edits.length === 0) return
    undoStack.current.push(active.edits)
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift()
    setUndoDepth(undoStack.current.length)
  }

  const undo = useCallback(() => {
    const edits = undoStack.current.pop()
    setUndoDepth(undoStack.current.length)
    // Inert when empty — never an error sound, never a greyed-out dead button.
    if (!edits) return
    revertEdits(grid.current, edits)
    repaint()
    playTone(330, 90, 'triangle', 0.07)
  }, [repaint])

  /** File a non-blank page into the gallery. Returns it, or null if blank. */
  const file = useCallback((): Drawing | null => {
    if (isBlank(grid.current)) return null
    const drawing = gridToDrawing(grid.current, { role, tag })
    saveDrawing(drawing)
    return drawing
  }, [role, tag])

  const clear = useCallback(() => {
    // 🗑️ files the current page first — nothing the child made is ever lost.
    file()
    grid.current = createGrid(size)
    undoStack.current = []
    setUndoDepth(0)
    repaint()
    playTone(660, 120, 'triangle', 0.1)
  }, [file, repaint, size])

  const done = useCallback(() => {
    const drawing = file()
    playTone(drawing ? 784 : 440, 140, 'triangle', 0.1)
    if (drawing) {
      playTone(988, 160, 'triangle', 0.09)
    }
    onDone(drawing)
  }, [file, onDone])

  // Leaving the pad (unmount, tab switch) files whatever is on it.
  const fileRef = useRef(file)
  fileRef.current = file
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') fileRef.current()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      fileRef.current()
    }
  }, [])

  // ─── Dev/e2e hook ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!exposeTestApi) return
    const api: PixelPadTestApi = {
      state: () => ({
        size,
        color: toolRef.current.color,
        eraser: toolRef.current.eraser,
        painted: grid.current.cells.reduce((n, cell) => (cell === PAPER ? n : n + 1), 0),
        blank: isBlank(grid.current),
        undoDepth: undoStack.current.length,
        askColor: askColor ?? null,
        canvasCss: { x: layout.canvasX, y: layout.canvasY, side: layout.side },
        cellCss: cellSize(layout.side, size),
      }),
      paint: (cells) => {
        const edits: CellEdit[] = []
        for (const cell of cells) paintCell(grid.current, cell.x, cell.y, cell.color, edits)
        if (edits.length > 0) {
          undoStack.current.push(edits)
          setUndoDepth(undoStack.current.length)
        }
        repaint()
      },
      done,
    }
    window.__pixelPad = api
    return () => {
      if (window.__pixelPad === api) delete window.__pixelPad
    }
  }, [exposeTestApi, size, askColor, layout.canvasX, layout.canvasY, layout.side, repaint, done])

  // ─── Render ────────────────────────────────────────────────────────────────

  // Two zones, because they obey different touch minimums: full-size TOOLS (a
  // wrong tool changes the mode) above a denser swatch grid (a wrong colour costs
  // one cell). layout.padLayout sized both to fit — see railFits.
  const railStyle: CSSProperties = {
    ...styles.rail,
    left: layout.railX,
    top: layout.railY,
    width: layout.railW,
    height: layout.railH,
    gap: layout.gap,
  }
  const toolZone: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.toolColumns}, ${layout.button}px)`,
    gap: layout.gap,
    justifyContent: 'center',
  }
  const swatchZone: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.swatchColumns}, ${layout.swatch}px)`,
    gap: layout.gap,
    justifyContent: 'center',
  }
  const toolStyle = (extra: CSSProperties = {}): CSSProperties => ({
    ...styles.tool,
    width: layout.button,
    height: layout.button,
    fontSize: Math.round(layout.button * 0.4),
    ...extra,
  })

  // ─── Easel chrome ──────────────────────────────────────────────────────────
  // Pure decoration derived from the instrument's own geometry: the frame hugs
  // the paper, the ledge hangs under it and the legs splay from the ledge. All of
  // it is `aria-hidden` — there is nothing here for a child (or a screen reader)
  // to operate.
  const easel = layout.easel
  const frameBox = easel && {
    x: layout.canvasX - easel.border,
    y: layout.canvasY - easel.border,
    side: layout.side + easel.border * 2,
  }
  const doneSide = layout.button * 1.2
  // The finish button RESTS ON THE LEDGE (clamped so it can never hang out of the
  // pad's own box on a short overlay), which is what makes the shelf load-bearing
  // rather than ornamental.
  const doneAnchor: CSSProperties =
    easel && frameBox
      ? {
          left: Math.min(
            frameBox.x + frameBox.side - doneSide * 0.92,
            Math.max(0, box.vw - doneSide - 8),
          ),
          top: Math.min(
            frameBox.y + frameBox.side + easel.ledge / 2 - doneSide / 2,
            Math.max(0, box.vh - doneSide - 6),
          ),
        }
      : {
          right: Math.max(12, layout.canvasX * 0.12),
          bottom: 'max(14px, env(safe-area-inset-bottom))',
        }

  return (
    <div ref={rootRef} style={styles.root}>
      {easel && frameBox && (
        <>
          {easel.legs > 0 &&
            [-1, 1].map((lean) => (
              <span
                key={lean}
                aria-hidden
                style={{
                  ...styles.easelLeg,
                  left: frameBox.x + frameBox.side * (lean < 0 ? 0.2 : 0.8),
                  top: frameBox.y + frameBox.side + easel.ledge - easel.border * 0.2,
                  width: Math.max(6, easel.border * 0.5),
                  height: easel.legs,
                  borderRadius: easel.border * 0.25,
                  transform: `translateX(-50%) rotate(${lean * 9}deg)`,
                }}
              />
            ))}
          <span
            aria-hidden
            style={{
              ...styles.easelFrame,
              left: frameBox.x,
              top: frameBox.y,
              width: frameBox.side,
              height: frameBox.side,
              borderRadius: easel.border * 0.9,
            }}
          />
          <span
            aria-hidden
            style={{
              ...styles.easelLedge,
              left: frameBox.x - easel.border * 0.5,
              top: frameBox.y + frameBox.side - easel.border * 0.2,
              width: frameBox.side + easel.border,
              height: easel.ledge,
              borderRadius: `${easel.border * 0.3}px ${easel.border * 0.3}px ${easel.border * 0.7}px ${easel.border * 0.7}px`,
            }}
          />
        </>
      )}
      <div
        style={{
          ...styles.canvasBox,
          left: layout.canvasX,
          top: layout.canvasY,
          width: layout.side,
          height: layout.side,
        }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        <canvas ref={paintRef} width={size} height={size} style={styles.paint} />
        <canvas ref={gridRef} style={styles.gridLines} />
      </div>

      <div style={railStyle}>
        <div style={toolZone}>
          {railTop}
          <button
            type="button"
            aria-label="Eraser"
            onClick={() => setTool((t) => ({ ...t, eraser: true }))}
            style={toolStyle({ background: tool.eraser ? '#ffd166' : 'rgba(255,255,255,0.9)' })}
          >
            🧽
          </button>
          {/* Never greyed into uselessness — an empty stack is simply inert. */}
          <button
            type="button"
            aria-label="Undo"
            onClick={undo}
            style={toolStyle({ opacity: undoDepth === 0 ? 0.45 : 1 })}
          >
            ↩︎
          </button>
          <button type="button" aria-label="New page" onClick={clear} style={toolStyle()}>
            🗑️
          </button>
        </div>
        <div style={swatchZone}>
          {SWATCHES.map((index) => {
            const active = !tool.eraser && tool.color === index
            return (
              <button
                key={index}
                type="button"
                aria-label={`Colour ${PALETTE[index]}`}
                onClick={() => {
                  setTool({ color: index, eraser: false })
                  playTone(430 + index * 24, 55, 'sine', 0.06)
                }}
                style={{
                  ...styles.swatch,
                  width: layout.swatch,
                  height: layout.swatch,
                  background: PALETTE[index],
                  outline: active ? '4px solid #fff' : '2px solid rgba(0,0,0,0.18)',
                  transform: active ? 'scale(1.06)' : 'none',
                }}
              />
            )
          })}
        </div>
      </div>

      {/* Done is the loudest thing on screen: the pad must never become a place
          a child settles into and forgets the game that asked for the drawing. */}
      <div style={{ ...styles.doneBox, ...doneAnchor }}>
        {askColor !== undefined && (
          <span aria-label="Asked colour" style={{ ...styles.blot, background: askColor }} />
        )}
        <button
          type="button"
          aria-label="Done"
          onClick={done}
          style={{ ...styles.done, width: layout.button * 1.2, height: layout.button * 1.2 }}
        >
          {doneLabel}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    background: 'linear-gradient(180deg, #f1e7d6 0%, #e4d6bd 100%)',
    touchAction: 'none',
    userSelect: 'none',
  },
  canvasBox: {
    position: 'absolute',
    borderRadius: 18,
    boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
    background: PAPER_HEX,
    overflow: 'hidden',
    touchAction: 'none',
  },
  paint: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    imageRendering: 'pixelated',
    touchAction: 'none',
  },
  gridLines: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  rail: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    border: 'none',
    borderRadius: 12,
    padding: 0,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  tool: {
    border: 'none',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.9)',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  doneBox: {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  // Wood tones taken from the pad's OWN palette (#b08968 / #6b4f3a) so the easel
  // is painted in colours the child can also paint with.
  easelFrame: {
    position: 'absolute',
    background: 'linear-gradient(158deg, #c9a483 0%, #b08968 46%, #8f6b4c 100%)',
    boxShadow: '0 14px 34px rgba(0,0,0,0.26), inset 0 2px 0 rgba(255,255,255,0.34)',
    pointerEvents: 'none',
  },
  easelLedge: {
    position: 'absolute',
    background: 'linear-gradient(180deg, #d0ab88 0%, #a87f5c 58%, #7d5c40 100%)',
    boxShadow: '0 10px 22px rgba(0,0,0,0.24), inset 0 2px 0 rgba(255,255,255,0.42)',
    pointerEvents: 'none',
  },
  easelLeg: {
    position: 'absolute',
    transformOrigin: 'top center',
    background: 'linear-gradient(180deg, #8a6a4d 0%, #6b4f3a 100%)',
    boxShadow: '0 4px 10px rgba(0,0,0,0.22)',
    pointerEvents: 'none',
  },
  blot: {
    display: 'block',
    width: 42,
    height: 42,
    borderRadius: '50%',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 0 0 3px rgba(255,255,255,0.7)',
  },
  done: {
    border: 'none',
    borderRadius: '50%',
    background: '#2f9e44',
    color: '#fff',
    fontSize: 34,
    fontWeight: 800,
    lineHeight: 1,
    boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
}

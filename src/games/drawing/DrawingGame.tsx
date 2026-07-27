/**
 * The PIXEL STUDIO — the drawing game, rebuilt around the shared pad.
 *
 * This route is deliberately thin: `shared/pixel/PixelPad` is the instrument and
 * this is its shell, adding only the three precision buttons and the gallery.
 * Those three buttons used to print the digits 16 / 32 / 64 — unreadable to the
 * player, so no label at all. They now show the SAME apple drawn at three block
 * resolutions (shared/pixel/icons), which says "bigger blocks / smaller blocks"
 * without a single character. The pad is shared because other games mount the
 * component as an overlay to commission art (Feed the Monster's drawn food is
 * the first), so anything the studio taught the pad would otherwise have to be
 * pulled back out again.
 *
 * Why a grid replaced the old freehand canvas: freehand had no adaptive axis at
 * all (nothing to get better at, nothing measured, nothing survived 🗑️), while a
 * grid has a real precision ladder — cell size halves at each step — and, more
 * importantly, produces a SPRITE. A grid of colour indices can walk into any
 * other game in this app; a smear of strokes is a photograph of a smear.
 *
 * Free play stays 100% no-fail: no clock, no score, no wrong pixel, and every
 * non-blank page is filed to the gallery on done, on 🗑️, on a size change and on
 * leaving the route.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import PixelPad from '../../shared/pixel/PixelPad'
import PadIcon from '../../shared/pixel/PadIcon'
import { gridIcon } from '../../shared/pixel/icons'
import { DEFAULT_GRID_SIZE, GRID_SIZES } from '../../shared/pixel/grid'
import type { Grid, GridSize } from '../../shared/pixel/grid'
import {
  deleteDrawing,
  drawingToGrid,
  drawingsSnapshot,
  subscribeArt,
} from '../../shared/pixel/artStore'
import type { Drawing } from '../../shared/pixel/artStore'
import { PALETTE, PAPER, PAPER_HEX } from '../../shared/pixel/palette'
import { playTone } from '../../shared/audio'

/** The shell pins home + level top-left; the pad's rail must clear them. */
const CHROME_TOP_CSS = 76

export default function DrawingGame() {
  const [size, setSize] = useState<GridSize>(DEFAULT_GRID_SIZE)
  const [gallery, setGallery] = useState(false)
  /** Set when a gallery drawing is re-opened; cleared on the next fresh page. */
  const [reopened, setReopened] = useState<{ grid: Grid; key: string } | null>(null)
  /** Bumped to force a genuinely fresh pad (a new page, not a re-render). */
  const [pageKey, setPageKey] = useState(0)

  // drawingsSnapshot (not listDrawings) — useSyncExternalStore compares by
  // identity, so a fresh array per render would loop forever.
  const drawings = useSyncExternalStore(subscribeArt, drawingsSnapshot)

  /**
   * Changing the grid size does not destroy work: the pad files whatever is on
   * it when it unmounts, and remounting under a new key opens a blank page of
   * the new size. Resampling 16→32 is tempting and wrong — it would produce art
   * the child did not make.
   */
  const pickSize = useCallback((next: GridSize) => {
    setReopened(null)
    setSize(next)
    setPageKey((k) => k + 1)
    playTone(next === 16 ? 523 : next === 32 ? 659 : 784, 110, 'triangle', 0.09)
  }, [])

  const reopen = useCallback((drawing: Drawing) => {
    setReopened({ grid: drawingToGrid(drawing), key: drawing.id })
    setSize((drawing.w === 32 ? 32 : drawing.w === 64 ? 64 : 16) as GridSize)
    setPageKey((k) => k + 1)
    setGallery(false)
    playTone(659, 120, 'triangle', 0.09)
  }, [])

  /** Done in free play just starts a fresh page — there is nobody waiting. */
  const onDone = useCallback(() => {
    setReopened(null)
    setPageKey((k) => k + 1)
  }, [])

  const railTop = useMemo(
    () => (
      <>
        {GRID_SIZES.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Grid ${value} by ${value}`}
            onClick={() => pickSize(value)}
            style={{
              ...styles.sizeButton,
              background: size === value ? '#4d96ff' : 'rgba(255,255,255,0.9)',
              color: size === value ? '#fff' : '#3d3a4b',
            }}
          >
            <PadIcon
              name={gridIcon(value)}
              fallback={value === 16 ? '▦' : value === 32 ? '▩' : '▨'}
            />
          </button>
        ))}
        <button
          type="button"
          aria-label="My drawings"
          onClick={() => {
            setGallery(true)
            playTone(880, 110, 'sine', 0.08)
          }}
          style={styles.sizeButton}
        >
          <PadIcon name="tool-gallery" fallback="🖼️" />
        </button>
      </>
    ),
    [pickSize, size],
  )

  return (
    <div style={styles.root}>
      <PixelPad
        key={`${size}-${pageKey}`}
        size={size}
        initial={reopened?.grid}
        onDone={onDone}
        railTop={railTop}
        railTools={GRID_SIZES.length + 1}
        chromeTop={CHROME_TOP_CSS}
        exposeTestApi
      />
      {gallery && <Gallery drawings={drawings} onPick={reopen} onClose={() => setGallery(false)} />}
    </div>
  )
}

/**
 * The fridge door: every drawing the child has ever made, tiled and tappable to
 * re-open. This is the strongest motivator in the app that costs no cleverness —
 * a child seeing their own history. Delete lives here too, small and in the
 * corner of a tile, for the adult.
 */
function Gallery({
  drawings,
  onPick,
  onClose,
}: {
  drawings: Drawing[]
  onPick: (drawing: Drawing) => void
  onClose: () => void
}) {
  return (
    <div style={styles.gallery}>
      <button type="button" aria-label="Close my drawings" onClick={onClose} style={styles.close}>
        ✕
      </button>
      {drawings.length === 0 ? (
        <div style={styles.empty} aria-label="No drawings yet">
          ▦
        </div>
      ) : (
        <div style={styles.tiles}>
          {drawings.map((drawing) => (
            <div key={drawing.id} style={styles.tileBox}>
              <button
                type="button"
                aria-label={`Open drawing ${drawing.id}`}
                onClick={() => onPick(drawing)}
                style={styles.tile}
              >
                <Thumb drawing={drawing} />
              </button>
              <button
                type="button"
                aria-label={`Delete drawing ${drawing.id}`}
                onClick={() => deleteDrawing(drawing.id)}
                style={styles.tileDelete}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A drawing as a CSS grid of divs. Tiny (16–64 cells a side at thumbnail size),
 * so DOM is simpler than a canvas here — and unlike the pad, a thumbnail never
 * takes pointer input per cell.
 */
function Thumb({ drawing }: { drawing: Drawing }) {
  const grid = useMemo(() => drawingToGrid(drawing), [drawing])
  return (
    <div
      aria-hidden
      style={{
        ...styles.thumb,
        gridTemplateColumns: `repeat(${grid.w}, 1fr)`,
      }}
    >
      {Array.from(grid.cells, (cell, i) => (
        <span
          key={i}
          style={{
            background:
              cell === PAPER
                ? 'transparent'
                : (drawing.palette[cell] ?? PALETTE[cell] ?? PAPER_HEX),
          }}
        />
      ))}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' },
  sizeButton: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    border: 'none',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.9)',
    color: '#3d3a4b',
    fontSize: 22,
    lineHeight: 1,
    width: '100%',
    aspectRatio: '1',
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  gallery: {
    position: 'absolute',
    inset: 0,
    zIndex: 5,
    padding: '76px 16px 16px',
    background: 'rgba(28, 24, 38, 0.94)',
    overflowY: 'auto',
  },
  close: {
    position: 'absolute',
    top: 'max(14px, env(safe-area-inset-top))',
    right: 'max(14px, env(safe-area-inset-right))',
    width: 56,
    height: 56,
    border: 'none',
    borderRadius: '50%',
    background: '#fff',
    color: '#3d3a4b',
    fontSize: 24,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  tiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 12,
  },
  tileBox: { position: 'relative' },
  tile: {
    display: 'block',
    width: '100%',
    aspectRatio: '1',
    padding: 6,
    border: 'none',
    borderRadius: 14,
    background: PAPER_HEX,
    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  tileDelete: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 28,
    height: 28,
    border: 'none',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.85)',
    color: '#3d3a4b',
    fontSize: 13,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  thumb: {
    display: 'grid',
    width: '100%',
    height: '100%',
    aspectRatio: '1',
    imageRendering: 'pixelated',
  },
  empty: {
    display: 'grid',
    placeItems: 'center',
    height: '60%',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 64,
  },
}

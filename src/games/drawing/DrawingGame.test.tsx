import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import DrawingGame from './DrawingGame'
import { GRID_SIZES } from '../../shared/pixel/grid'

/**
 * The studio's rail is the one place in the app that had TEXT AIMED AT THE CHILD:
 * the three precision buttons printed 16 / 32 / 64 beside their glyph. The player
 * cannot read, so those digits were not a weak label — they were no label, and the
 * project's rule (CLAUDE.md) forbids them outright. They are now three apples drawn
 * at three block resolutions.
 *
 * This pins both halves of that, because both are one careless edit away from
 * coming back: nothing readable renders INTO the rail, and every `aria-label` — the
 * only text the app is allowed, and what e2e/drawing.spec.ts and screen readers
 * locate these controls by — survives untouched.
 */

/** The pad measures its own box; jsdom has no ResizeObserver to measure with. */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver
  // The pad already treats a missing 2D context as "nothing to paint yet"; saying
  // so outright keeps jsdom from shouting "not implemented" across the run.
  HTMLCanvasElement.prototype.getContext = () => null
})

afterEach(cleanup)

describe('the studio rail, read by someone who cannot read', () => {
  it('shows the grid sizes as art, with no digits and their aria-labels intact', () => {
    render(<DrawingGame />)

    for (const size of GRID_SIZES) {
      const button = screen.getByRole('button', { name: `Grid ${size} by ${size}` })
      // No printed number, no glyph fallback — an icon, and nothing to read.
      expect(button.textContent).toBe('')
      const icon = button.querySelector('img')
      expect(icon, `grid ${size} must render its apple`).not.toBeNull()
      // alt="" keeps the button's aria-label the single accessible name.
      expect(icon).toHaveAttribute('alt', '')
      expect(icon).toHaveAttribute('draggable', 'false')
      // Sized as a share of the button (which padLayout sizes), never from the
      // PNG's own ~600 px — an intrinsic-size icon would burst the rail.
      expect(icon?.style.width).toMatch(/%$/)
      expect(icon?.style.height).toMatch(/%$/)
      // Inert to pointers, so it cannot steal the press or start a native drag.
      expect(icon?.style.pointerEvents).toBe('none')
    }

    // Each size gets its OWN apple: three identical icons would say nothing.
    const sources = GRID_SIZES.map(
      (size) =>
        screen.getByRole('button', { name: `Grid ${size} by ${size}` }).querySelector('img')?.src,
    )
    expect(new Set(sources).size).toBe(GRID_SIZES.length)

    // Nothing anywhere on the pad prints a number at the child.
    expect(document.body.textContent ?? '').not.toMatch(/\d/)
  })

  it('keeps every rail control findable by the name the specs use', () => {
    render(<DrawingGame />)
    for (const name of ['My drawings', 'Eraser', 'Undo', 'New page', 'Done']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })
})

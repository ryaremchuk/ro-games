import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeedDevPanel from './FeedDevPanel'

/**
 * The panel is an adult debugging overlay pinned over the top-right of the stage,
 * so what matters here is that it FOLDS AWAY and stays folded: covering the round
 * you are debugging was the whole complaint.
 *
 * No scene hook is installed in these tests on purpose — the overlay must render
 * and fold before Phaser has booted (it polls for the handle), which is exactly
 * the state an adult sees on a cold load.
 *
 * The panel is `aria-hidden` (nothing here is for the child), which takes it out of
 * the accessibility tree — so everything below is found by TEXT, never by role.
 */

/** Every control the open panel offers, minus the fold toggle itself. */
function controlCount(): number {
  return document.querySelectorAll('button').length - 1
}

describe('FeedDevPanel', () => {
  beforeEach(() => {
    sessionStorage.clear()
    // The panel polls the scene every 400 ms; frozen timers keep this suite off it.
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Vitest runs without `globals`, so RTL's auto-cleanup is not registered and
    // one test's panel would still be in the document during the next one.
    cleanup()
    vi.useRealTimers()
  })

  it('renders with no scene installed and offers a fold toggle', () => {
    render(<FeedDevPanel />)

    expect(screen.getByText('waiting for scene…')).toBeInTheDocument()
    expect(screen.getByText('DEV ▴')).toBeInTheDocument()
    expect(controlCount()).toBeGreaterThan(0)
  })

  it('collapses to a single toggle and hides the controls', () => {
    render(<FeedDevPanel />)
    const buttonsWhenOpen = document.querySelectorAll('button').length

    fireEvent.click(screen.getByText('DEV ▴'))

    expect(document.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByText('DEV ▾')).toBeInTheDocument()
    expect(screen.queryByText('waiting for scene…')).not.toBeInTheDocument()
    expect(screen.queryByText('✌ Duo')).not.toBeInTheDocument()
    expect(buttonsWhenOpen).toBeGreaterThan(1)

    // The poll keeps running while folded; it must not unfold the panel by itself.
    vi.advanceTimersByTime(2_000)
    expect(document.querySelectorAll('button')).toHaveLength(1)
  })

  it('expands back to the full panel', () => {
    render(<FeedDevPanel />)
    fireEvent.click(screen.getByText('DEV ▴'))

    fireEvent.click(screen.getByText('DEV ▾'))

    expect(screen.getByText('DEV ▴')).toBeInTheDocument()
    expect(screen.getByText('waiting for scene…')).toBeInTheDocument()
    expect(screen.getByText('✌ Duo')).toBeInTheDocument()
  })

  it('remembers the fold across a remount, both ways', () => {
    const first = render(<FeedDevPanel />)
    fireEvent.click(screen.getByText('DEV ▴'))
    first.unmount()

    const second = render(<FeedDevPanel />)
    expect(screen.getByText('DEV ▾')).toBeInTheDocument()
    expect(document.querySelectorAll('button')).toHaveLength(1)

    fireEvent.click(screen.getByText('DEV ▾'))
    second.unmount()

    render(<FeedDevPanel />)
    expect(screen.getByText('DEV ▴')).toBeInTheDocument()
    expect(controlCount()).toBeGreaterThan(0)
  })

  it('still renders when storage is unavailable', () => {
    const blocked = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    render(<FeedDevPanel />)
    fireEvent.click(screen.getByText('DEV ▴'))
    expect(screen.getByText('DEV ▾')).toBeInTheDocument()

    blocked.mockRestore()
    set.mockRestore()
  })
})

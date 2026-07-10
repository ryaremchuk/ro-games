import { Suspense } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'
import { lazyWithReload } from './lazyWithReload'
import { reloadPage } from './reload'

vi.mock('./reload', () => ({ reloadPage: vi.fn() }))

const RELOAD_FLAG = 'ro-games:chunk-reload'

function renderLazy(factory: () => Promise<{ default: () => React.JSX.Element }>) {
  const LazyComponent = lazyWithReload(factory)
  return render(
    <ErrorBoundary>
      <Suspense fallback={<div data-testid="loading" />}>
        <LazyComponent />
      </Suspense>
    </ErrorBoundary>,
  )
}

describe('lazyWithReload', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the component and clears the reload flag on success', async () => {
    sessionStorage.setItem(RELOAD_FLAG, '1')
    renderLazy(() => Promise.resolve({ default: () => <div data-testid="game" /> }))

    expect(await screen.findByTestId('game')).toBeInTheDocument()
    expect(reloadPage).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBeNull()
  })

  it('reloads the page once when a chunk fails to load', async () => {
    renderLazy(() => Promise.reject(new Error('failed to fetch chunk')))

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1')
    // Stays on the Suspense fallback (the page is reloading), no crash.
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('falls through to the ErrorBoundary when a chunk fails again after a reload', async () => {
    sessionStorage.setItem(RELOAD_FLAG, '1')
    // React logs the caught error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderLazy(() => Promise.reject(new Error('failed to fetch chunk')))

    const reloadButton = await screen.findByRole('button', { name: 'Reload' })
    expect(reloadPage).not.toHaveBeenCalled()

    reloadButton.click()
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })
})

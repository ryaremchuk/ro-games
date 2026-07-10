import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import { reloadPage } from './reload'

const RELOAD_FLAG = 'ro-games:chunk-reload'

function hasReloadFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) !== null
  } catch {
    return true // storage unavailable → never auto-reload (avoid loops)
  }
}

function setReloadFlag(value: boolean) {
  try {
    if (value) sessionStorage.setItem(RELOAD_FLAG, '1')
    else sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    // ignore — storage unavailable
  }
}

/**
 * Like React.lazy, but when a code-split chunk fails to load — typically
 * because a new deploy replaced the hashed files an already-open (stale) PWA
 * still references — reloads the page once to pick up the fresh index.html
 * instead of leaving a blank screen. A sessionStorage flag prevents reload
 * loops: a second consecutive failure propagates to the ErrorBoundary.
 */
export function lazyWithReload<T extends ComponentType>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const module = await factory()
      setReloadFlag(false)
      return module
    } catch (error) {
      if (hasReloadFlag()) throw error
      setReloadFlag(true)
      reloadPage()
      // The page is reloading; keep Suspense pending instead of crashing.
      return new Promise<never>(() => {})
    }
  })
}

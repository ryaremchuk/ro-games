/**
 * Visible-viewport helpers for full-screen canvases.
 *
 * On iOS — especially iOS 26 home-screen PWAs — `window.innerWidth/innerHeight`
 * report the *layout* viewport, which can disagree with what is actually on
 * screen (stale after launch/rotation, or excluding the home-indicator strip).
 * A canvas sized from it gets cropped at the right/bottom edges while plain
 * backgrounds still "look right". `window.visualViewport` reports the region
 * the user really sees, so prefer it and fall back to `window.inner*`.
 */
export function viewportSize(): { width: number; height: number } {
  const vv = window.visualViewport
  return {
    width: Math.max(Math.round(vv?.width ?? window.innerWidth), 1),
    height: Math.max(Math.round(vv?.height ?? window.innerHeight), 1),
  }
}

/**
 * Subscribe to every event that can change the visible viewport on iOS.
 * `visualViewport` fires resize in standalone-PWA cases where `window` does
 * not (e.g. the viewport settling shortly after launch). Returns unsubscribe.
 */
export function onViewportResize(handler: () => void): () => void {
  window.addEventListener('resize', handler)
  window.addEventListener('orientationchange', handler)
  window.visualViewport?.addEventListener('resize', handler)
  return () => {
    window.removeEventListener('resize', handler)
    window.removeEventListener('orientationchange', handler)
    window.visualViewport?.removeEventListener('resize', handler)
  }
}

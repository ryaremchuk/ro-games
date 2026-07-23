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
  // Canvases must fill the app shell (#root at 100lvh = the physical screen;
  // portrait iOS 26 cuts the ICB/visualViewport ~44pt short of it, verified
  // on-device via #/viewport-debug). Width still takes the smaller of the ICB
  // and visualViewport — the landscape layout viewport over-reports width,
  // which cropped the right edge of canvases (the corner sun).
  const vv = window.visualViewport
  const icb = document.documentElement
  const shellHeight = document.getElementById('root')?.clientHeight
  return {
    width: Math.max(Math.round(Math.min(vv?.width ?? Infinity, icb.clientWidth)), 1),
    height: Math.max(
      Math.round(shellHeight ?? Math.min(vv?.height ?? Infinity, icb.clientHeight)),
      1,
    ),
  }
}

/**
 * The `env(safe-area-inset-*)` value in CSS px, measured off a throwaway probe
 * element (the only way to read `env()` from JS). Returns 0 when unsupported or
 * when there is no inset — e.g. desktop, or a device with no notch/home bar.
 * Full-bleed canvases (Scale.NONE + full-screen `#root`) don't get the inset
 * for free the way padded DOM layouts do, so a game that must stay clear of the
 * home-indicator / notch has to fold this into its own layout math.
 */
export function safeAreaInset(side: 'top' | 'bottom' | 'left' | 'right'): number {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;visibility:hidden;height:env(safe-area-inset-${side},0px)`
  document.body.appendChild(el)
  const px = el.getBoundingClientRect().height
  el.remove()
  return Number.isFinite(px) ? px : 0
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

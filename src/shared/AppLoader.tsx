import './AppLoader.css'

/**
 * Suspense fallback while a game chunk loads. Invisible for the first ~400ms
 * so instant (precached) loads never flash anything; on a genuinely slow load
 * it fades in a centered progress bar that trickles forward (chunk fetches
 * expose no real progress, so the fill is time-based fast-then-slow).
 */
export default function AppLoader() {
  return (
    <div className="app-loader" role="progressbar" aria-label="Loading">
      <div className="app-loader-track">
        <div className="app-loader-fill" />
      </div>
    </div>
  )
}

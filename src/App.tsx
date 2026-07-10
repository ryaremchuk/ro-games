import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './launcher/HomePage'
import AppLoader from './shared/AppLoader'
import ErrorBoundary from './shared/ErrorBoundary'
import GameFrame from './shared/GameFrame'
import { games } from './games/registry'

export default function App() {
  // The static boot loader in index.html covered the JS bundle download;
  // once React has committed, fade it away.
  useEffect(() => {
    const loader = document.getElementById('boot-loader')
    if (!loader) return
    loader.classList.add('boot-loader-done')
    const timer = window.setTimeout(() => loader.remove(), 300)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {games.map((game) => {
          const GameComponent = game.component
          return (
            <Route
              key={game.id}
              path={game.path}
              element={
                <GameFrame title={game.title}>
                  {/* Per-route Suspense: router navigations run in a transition,
                      which keeps the previous screen visible instead of showing
                      a shared top-level fallback. A boundary that mounts WITH
                      the new route shows its fallback immediately — and the
                      home button stays reachable while the chunk loads. */}
                  <Suspense fallback={<AppLoader />}>
                    <GameComponent />
                  </Suspense>
                </GameFrame>
              }
            />
          )
        })}
        {/* Unknown routes fall back to the launcher. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

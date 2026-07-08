import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './launcher/HomePage'
import GameFrame from './shared/GameFrame'
import { games } from './games/registry'

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading" aria-hidden />}>
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
                  <GameComponent />
                </GameFrame>
              }
            />
          )
        })}
        {/* Unknown routes fall back to the launcher. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

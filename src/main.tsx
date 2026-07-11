import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { setupSWUpdates } from './shared/swUpdate'
import './index.css'

// Register the service worker and silently apply new releases (see swUpdate).
setupSWUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)

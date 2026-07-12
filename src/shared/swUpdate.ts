import { registerSW } from 'virtual:pwa-register'

/**
 * Silent-update flow for the installed PWA.
 *
 * `registerType: 'prompt'` (vite.config.ts) keeps the OLD service worker — and
 * its complete precache — in control until we explicitly apply the update, so
 * a running page never mixes old lazy chunks with a new cache and offline play
 * stays consistent. The new worker finishes precaching BEFORE `onNeedRefresh`
 * fires, so the reload below always lands on a fully cached new version.
 *
 * Update checks run on launch, on every return to the foreground (iOS resumes
 * a home-screen PWA from a snapshot with no navigation, so the browser's own
 * launch-time check often never happens), and hourly for long sessions.
 * Applying an update = one silent reload, done only on the launcher so a game
 * in progress is never interrupted; leaving a game always passes through the
 * launcher, which applies any deferred update there.
 */
export function setupSWUpdates(): void {
  // HashRouter home route: '', '#' and '#/' are all the launcher.
  const atLauncher = () => ['', '#', '#/'].includes(window.location.hash)

  let updateReady = false

  const applyIfAtLauncher = () => {
    if (!updateReady || !atLauncher()) return
    updateReady = false
    void updateSW(true) // activate the waiting worker and reload
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true
      applyIfAtLauncher()
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      // Offline / flaky network: a failed check is fine — keep playing from
      // the cache and try again on the next foreground/interval tick.
      const check = () => registration.update().catch(() => {})
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check()
      })
      window.setInterval(() => void check(), 60 * 60 * 1000)
    },
  })

  window.addEventListener('hashchange', applyIfAtLauncher)
}

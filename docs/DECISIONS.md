# Decisions

Short log of non-obvious choices, so we don't relitigate them later.

## Stack

- **React + Vite + TypeScript.** Vite for fast builds and trivial static Pages
  deploys; React for the shell's component model; TS because most code here is
  AI-generated and types keep it maintainable.
- **Latest stable, few majors.** Deliberately track the versions `create-vite`
  ships (React 19, Vite 8, TS 6, `@vitejs/plugin-react` 6) plus `@latest` for
  everything else, so we update rarely rather than constantly.

## Linting: oxlint, not ESLint

`create-vite` now defaults to **oxlint** (Rust, fast, near-zero config). We kept
it instead of the ESLint + typescript-eslint + plugins stack. Rationale: far less
version-alignment churn (the usual update treadmill), and it covers
rules-of-hooks / exhaustive-deps for our needs. Prettier handles formatting.

## Rendering: Phaser from day 0, but Canvas for drawing

- **Phaser 4 installed from the start** so future games (memory, RPG, hidden
  object) have the engine and the `PhaserGame` mount ready — no later infra
  scramble.
- **The drawing game uses raw Canvas 2D, not Phaser.** Phaser adds nothing to
  freehand drawing and would only get in the way. Phaser is not bundled unless a
  game imports `PhaserGame`, so this costs the launcher nothing.
- **Game loops never run through React state** — per-frame `setState` causes
  jank, which directly undermines the "smooth animations" goal.

## Routing: HashRouter

GitHub Pages has no SPA fallback, so `BrowserRouter` deep links 404 on refresh.
`HashRouter` avoids that entirely. The ugly `#/` URL is irrelevant for a kiosk
app opened from the iPad home screen.

## Base path: `/ro-games/`

Project Pages site lives at `ryaremchuk.github.io/ro-games/`, so Vite `base`,
the PWA manifest `start_url`/`scope`, and injected asset links all use
`/ro-games/`. Lighthouse CI builds with `--base=/` (`build:ci`) because its
static server serves from root.

## PWA on GitHub Pages

Pages serves over HTTPS, which is all a service worker needs. Installing to the
iPad home screen gives fullscreen standalone launch (escaping Safari's gestures)
and offline play. Icons are generated from one `public/logo.svg` via
`@vite-pwa/assets-generator`, so there are no hand-maintained PNGs.

## Status bar: `default`, not `black-translucent`

`black-translucent` looked like free full-bleed, but on-device debugging
(`#/viewport-debug`) showed iOS sizes the standalone webview
screen-minus-status-bar while anchoring it at the top — leaving a dead strip at
the physical bottom that is **outside the webview**: `100lvh` reports the full
screen but never renders there, and no CSS can paint it (iPad both
orientations, iPhone portrait). `default` places the webview below an opaque
status bar and it reaches the bottom edge. iOS bakes this setting in at
Add-to-Home-Screen time, so changing it means re-adding the icon.

## PWA updates: `prompt` + silent reload on the launcher

`registerType: 'autoUpdate'` alone left the app one launch behind every release
(and iOS resuming the PWA from a snapshot skips the launch update check
entirely, hence "close it twice"). Worse, a new worker replacing the precache
under a running page breaks that page's old lazy chunks offline. So:
`'prompt'` keeps the old worker in control until `src/shared/swUpdate.ts`
applies the update — checks on launch / foreground / hourly, then one silent
reload, only ever on the launcher so games are never interrupted. Offline the
check just fails quietly and the cached version keeps playing.

## Kiosk trade-offs (intentional)

- Global CSS disables text selection, tap highlight, scroll bounce; the viewport
  meta disables pinch-zoom. This is right for a 3-year-old on an iPad even though
  Lighthouse flags `user-scalable=no` as an accessibility issue — hence the
  Lighthouse accessibility gate is a **warning**, not a hard failure, for now.
- **Escape hatch beyond the app:** the in-app home button plus iOS **Guided
  Access** (triple-click to lock the iPad to one app) are the intended way to
  keep the child inside the game. A software-only lock can't fully block Safari
  gestures.

## CI conventions

- **Conventional Commits**, enforced by commitlint (commit-msg hook) and Danger
  (PR title, since PRs squash-merge).
- **Danger** enforces PR hygiene (title, description, size, leftover
  `console.log`, lockfile drift) and the project rule that a new game folder must
  update the registry.
- **Lighthouse CI** guards performance / accessibility / best-practices as
  warnings for now; tighten to errors once the baselines are known.

## Progress: two-axis adaptive skill + warm-up start + stars

Decided when persistence landed (July 2026), after weighing three options for
"where does a session start": always-from-zero (bored a returning child with
re-learned basics), exact-resume (cold-started a fluctuating 3-4yo skill at
its ceiling), and the chosen hybrid:

- **Skill meters persist, sessions start below them.** Saved to
  `localStorage` after every round (`src/shared/progress.ts` — toddlers don't
  do graceful shutdowns), restored minus `WARMUP_DROP`, minus one step per
  week away, and climbed back at doubled up-steps while below the saved peak.
  The warm-up doubles as re-teaching, and it lasts rounds, not half a session.
- **Two axes where the skills differ.** Balloon Pop splits MOTOR (speed,
  concurrency; error = the match escaped) from COGNITIVE (targets,
  distractors, task types; error = wrong tap), because one meter forced a
  false trade: a slow-fingered sharp counter got easier _numbers_ when only
  the _sky_ needed slowing. Motor never climbs during a cognitively rough
  round — speed must not pile onto struggle. Games with one real skill (Odd
  One Out's category ladder) persist a single axis; the store is
  axis-name-agnostic.
- **Stars, not levels, are the persistent trophy.** Levels stay a
  session-scoped reward rhythm (they only move forward while playing); stars
  bank one per celebration beat, live forever, and show on the launcher tile.
  Rewarding the _beat_ (effort) rather than level-ups keeps the economy fair:
  a child at the skill ceiling still earns stars at the same rate as one
  still climbing.

## Deferred (not done yet, on purpose)

- **Parent gate** (hold-to-confirm) before leaving a game or opening external
  links — planned once there's anything external to protect.
- **Undo** in the drawing game (only clear-all exists in v1).
- **Shared assets / real art** — currently emoji placeholders on tiles;
  Kenney.nl (CC0) and/or AI-generated art to come. This is expected to be the
  main bottleneck, not code.
- **PR preview deploys** — awkward on Pages; skipped.

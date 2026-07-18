# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ro Games is a picture-only web arcade of small games for a 3–4 year old. It is
installed as a PWA on an iPad and hosted on GitHub Pages at
https://ryaremchuk.github.io/ro-games/. **The player cannot read yet** — every
interaction is visual + audio, touch-first, with large hit targets and no text
aimed at the child (text labels exist only as `aria-label`s).

## Commands

- `npm run dev` — dev server (served under the `/ro-games/` base).
- `npm run build` — `tsc -b` typecheck + production build + PWA icon/SW generation.
- `npm run build:ci` — build at root base (`/`) so the Lighthouse static server can serve it.
- `npm run preview` — serve the production `dist/` locally (open `/ro-games/`).
- `npm run lint` / `npm run lint:fix` — oxlint.
- `npm run format` / `npm run format:check` — Prettier.
- `npm run typecheck` — `tsc -b` (no emit).
- `npm run test` / `npm run test:watch` — Vitest.
- Single test file: `npx vitest run src/games/registry.test.ts`
- Single test by name: `npx vitest run -t "unique ids"`
- `npm run gen:icons` — regenerate PWA icons from `public/logo.svg`.
- `npm run lhci` — run Lighthouse CI locally against `./dist`.

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, `test`,
`build` on every push/PR, plus Danger and Lighthouse on PRs. Run those locally
before pushing.

## Architecture

Two deliberately decoupled layers:

1. **Shell / launcher** (`src/main.tsx`, `src/App.tsx`, `src/launcher/`): a
   `HashRouter` SPA. `HomePage` is a picture-only grid of tiles, one per game.
   Routes are generated from the game registry, not hand-written.
2. **Games** (`src/games/<id>/`): each game is self-contained and shares nothing
   with other games. Every game renders inside `GameFrame`
   (`src/shared/GameFrame.tsx`), which supplies the persistent home button and
   unlocks iOS audio on first touch.

**Game registry — `src/games/registry.tsx` is the single source of truth.** Each
entry (`{ id, title, path, color, emoji, component: lazy(() => import(...)) }`)
auto-generates both a launcher tile and a route. Components are `lazy()`, so each
game is its own code-split chunk. To add a game: create `src/games/<id>/` with a
default-exported component, then add one registry entry. Danger fails any PR that
adds a `src/games/<name>/` folder without touching `registry.tsx`.

**Rendering engine — do NOT run game loops through React state** (per-frame
`setState` causes jank and defeats the "smooth animations" goal):

- Simple tap/draw games → Canvas 2D directly. See
  `src/games/drawing/DrawingGame.tsx` (pointer events, quadratic-curve stroke
  smoothing, `devicePixelRatio` scaling for crisp hi-DPI lines).
- Games with movement / sprites / physics / particles → **Phaser 4** via
  `src/shared/PhaserGame.tsx` (mounts and destroys a `Phaser.Game` in a div).
  Phaser is only pulled into the chunk of a game that imports `PhaserGame`, so
  the launcher and Canvas-only games stay small.

**Audio — `src/shared/audio.ts`** synthesizes tones with the Web Audio API (no
audio asset files). iOS keeps audio suspended until a user gesture; `GameFrame`
calls `unlockAudio()` on the first `pointerdown`. Games call `playTone(...)`.

**Progress — `src/shared/progress.ts`** persists per-game adaptive skill
meters and reward stars in `localStorage`. Uniform rule in every game:
passing a level (the game's own unit — solved round, cleared board, ten
bops) ticks the badge +1 and banks one star via `addStars()`. Games with an
adaptive meter save it every round and start sessions below the saved value
via `sessionStart()` (warm-up + break decay), climbing back faster below the
saved peak. Three decoupled currencies: skill is invisible and adaptive (two
axes — motor/cognitive — where the skills differ), levels are a
session-scoped reward rhythm, stars are forever. Celebrations are pure
animations on per-game `CELEBRATION_EVERY_*` beats. See `docs/DECISIONS.md`
("Progress: two-axis adaptive skill").

## Conventions & constraints

- **Base path is `/ro-games/`** (GitHub Pages project site). `HashRouter` avoids
  the Pages deep-link 404 problem. Keep in-app asset references base-aware.
- **Kiosk CSS is intentional**: global CSS disables zoom, text selection, and
  scroll bounce (`src/index.css`), and the viewport meta disables pinch-zoom.
  This is deliberate for a toddler on an iPad — do not "fix" it for a11y.
- **Conventional Commits are required.** PRs squash-merge, so the PR _title_
  becomes the commit. commitlint + Danger enforce it. Husky runs `lint-staged`
  (oxlint --fix + prettier) pre-commit and commitlint on commit-msg.
- **Deployment is automatic**: pushing to `main` triggers
  `.github/workflows/deploy.yml`, which builds and deploys to Pages. Never deploy
  by hand.

## More docs

- `docs/ARCHITECTURE.md` — deeper structure and the add-a-game recipe.
- `docs/DECISIONS.md` — why the key choices were made (Phaser from day 0,
  HashRouter, oxlint over ESLint, no-zoom kiosk, PWA on Pages, …).

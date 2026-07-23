# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ro Games is a picture-only web arcade of small games for a 3–4 year old. It is
installed as a PWA on an iPad and hosted on GitHub Pages at
https://ryaremchuk.github.io/ro-games/. **The player cannot read yet** — every
interaction is visual + audio, touch-first, with large hit targets and no text
aimed at the child (text labels exist only as `aria-label`s).

**North star — adaptive challenge = learning.** Every game must keep hunting
the edge of the child's ability and nudge it forward: measure the play, adapt
the difficulty invisibly, never boring, never frustrating. Judge every future
feature against this: does it help the child learn and grow?

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

## How we work

- **Layouts are proportional**: size and position everything as a fraction of the viewport, never hardcoded px (fixed px only for physical safe-area minimums) — must read equally well on iPad (4:3) and iPhone-landscape (~2.2:1).
- **No workarounds**: fix root causes with best-practice solutions and verify them (tests + measured on target devices) before calling it done — never patch symptoms.

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

- `docs/ARCHITECTURE.md` — the full architecture: the shell/games layering, the
  registry as single source of truth, per-game rendering engines (Canvas 2D vs
  Phaser 4), the shared frame (audio, level & progress stores), the directory
  map, the add-a-game recipe, and PWA/hosting/CI-CD.
- `docs/DECISIONS.md` — why the key choices were made (Phaser from day 0,
  HashRouter, oxlint over ESLint, no-zoom kiosk, PWA on Pages, …).

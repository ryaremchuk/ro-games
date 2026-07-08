# Ro Games 🎮

A picture-only web arcade of small games for a 3–4 year old — installed as a PWA
on an iPad, hosted free on GitHub Pages. No ads, no tracking, full control.

**Live:** https://ryaremchuk.github.io/ro-games/

The player can't read yet, so everything is visual + audio and touch-first. The
home screen is a launcher of big tiles — one tile per game — and each game is
fully self-contained.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173/ro-games/
```

## Scripts

| Command                                          | What                                      |
| ------------------------------------------------ | ----------------------------------------- |
| `npm run dev`                                    | Dev server                                |
| `npm run build`                                  | Typecheck + production build + PWA assets |
| `npm run preview`                                | Serve the production build locally        |
| `npm run lint` / `format` / `typecheck` / `test` | Quality gates (also run in CI)            |

## How it's built

React + Vite + TypeScript shell (HashRouter) that launches isolated games.
Simple games use Canvas 2D; richer games use Phaser 4. PWA via
`vite-plugin-pwa`. Deploys to GitHub Pages automatically on push to `main`.

- Add a game: see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Why the key choices: see [`docs/DECISIONS.md`](docs/DECISIONS.md).
- Guidance for Claude Code: see [`CLAUDE.md`](CLAUDE.md).

## Games

- **Drawing** 🖍️ — white canvas, colors, brush sizes, eraser, clear-all.

## Running it on the iPad

1. Open the live URL in Safari → Share → **Add to Home Screen** (installs the PWA
   fullscreen).
2. Use iOS **Guided Access** (triple-click the side button) to lock the iPad to
   the app so the child can't wander off into Safari.

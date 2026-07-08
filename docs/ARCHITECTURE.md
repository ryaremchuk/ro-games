# Architecture

## Goal

A single website that launches many small, independent games for a pre-reader
(3–4 y/o), installed as a PWA on an iPad. Smooth animations, nice visuals,
audio feedback, no text the child must read. Hosted free on GitHub Pages.

## Layers

```
┌───────────────────────────────────────────────────────────┐
│  Shell (HashRouter SPA)                                     │
│  main.tsx → App.tsx → HomePage (picture-only launcher)      │
│                     └→ /<game> → GameFrame → <Game/>        │
└───────────────────────────────────────────────────────────┘
        │ reads
        ▼
┌───────────────────────────────────────────────────────────┐
│  Game registry  (src/games/registry.tsx)                   │
│  one entry per game → tile on HomePage + route in App       │
└───────────────────────────────────────────────────────────┘
        │ lazy import
        ▼
┌───────────────────────────────────────────────────────────┐
│  Games (src/games/<id>/) — self-contained, share nothing    │
│  render engine chosen per game:                             │
│    Canvas 2D            (drawing)                           │
│    Phaser 4             (movement/sprites/physics — via      │
│                          shared/PhaserGame.tsx)             │
└───────────────────────────────────────────────────────────┘
```

Shared frame only (`src/shared/`), never shared game logic:

- `GameFrame.tsx` — home button + iOS audio unlock, wraps every game.
- `PhaserGame.tsx` — reusable mount/destroy for a `Phaser.Game`.
- `audio.ts` — Web Audio tone synthesis + `unlockAudio()`.

## Directory map

```
src/
  main.tsx              app entry: HashRouter + StrictMode
  App.tsx               routes, generated from the registry
  index.css             global reset + kiosk touch rules
  launcher/
    HomePage.tsx/.css   picture-only grid of game tiles
  shared/
    GameFrame.tsx/.css  chrome around every game
    PhaserGame.tsx      Phaser mount point (day-0 infra)
    audio.ts            Web Audio helpers
  games/
    registry.tsx        SINGLE SOURCE OF TRUTH for games
    drawing/            first game (Canvas 2D)
      DrawingGame.tsx/.css
public/
  logo.svg              source image for PWA icons
  favicon.svg
```

## Adding a game

1. `mkdir src/games/<id>` and add `<Something>Game.tsx` with a **default export**
   (a component that fills its container — the `GameFrame` surface is
   `position: absolute; inset: 0`).
2. Choose the engine:
   - Canvas 2D for simple tap/draw (copy the setup from `DrawingGame.tsx`:
     `devicePixelRatio` scaling, pointer events, refs — not state — for the draw
     loop).
   - Phaser for anything with motion. Import `PhaserGame` and pass a `config`;
     Phaser is code-split into this game's chunk automatically.
3. Register it in `src/games/registry.tsx`:

   ```tsx
   {
     id: 'memory',
     title: 'Memory',
     path: '/memory',
     color: '#4dabf7',
     emoji: '🃏',
     component: lazy(() => import('./memory/MemoryGame')),
   }
   ```

   That's all — the tile and route appear automatically. (Danger will fail the
   PR if you add the folder but forget this step.)

4. Use `playTone(...)` from `shared/audio.ts` for sound. Audio is already
   unlocked by `GameFrame`.

## Rendering rules

- Never drive per-frame animation from React state. Use `requestAnimationFrame`
  (Phaser does this for you) or imperative Canvas draws in event handlers.
- Design for touch: large targets, no hover, no right-click, pointer events
  (one code path for touch + mouse), `touch-action: none` on drawing surfaces.

## PWA & hosting

- `vite-plugin-pwa` generates the service worker (autoUpdate) and, via
  `pwa-assets.config.ts`, all icons from `public/logo.svg`.
- `base: '/ro-games/'` in `vite.config.ts` matches the Pages project path.
  `HashRouter` sidesteps the SPA deep-link 404 on Pages.
- Offline: the SW precaches the built assets so games run without wifi and the
  app can be added to the iPad home screen (fullscreen, standalone).

## CI/CD

- `ci.yml` (push/PR): `format:check` → `lint` → `typecheck` → `test` → `build`;
  Danger + Lighthouse on PRs.
- `deploy.yml` (push to `main`): build → `upload-pages-artifact` →
  `deploy-pages`. Deployment is automatic; do not deploy manually.
- Lighthouse builds with `--base=/` (`build:ci`) so its static server can serve
  the site at root.

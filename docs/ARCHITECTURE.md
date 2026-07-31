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
│    Canvas 2D            (drawing — the pixel studio)        │
│    Phaser 4             (movement/sprites/physics — via      │
│                          shared/PhaserGame.tsx)             │
└───────────────────────────────────────────────────────────┘
```

Shared frame only (`src/shared/`), never shared game logic:

- `GameFrame.tsx` — home button, the standardized level badge (top-left,
  next to home) + iOS audio unlock, wraps every game.
- `PhaserGame.tsx` — reusable mount/destroy for a `Phaser.Game`.
- `audio.ts` — Web Audio tone synthesis + `unlockAudio()`.
- `level.ts` — the single source of truth for a game's visible level:
  `levelFor(gameId) = stars + 1`, derived live from the observable star store.
  Both the in-game badge (`GameFrame`) and the launcher tile (`HomePage`) read
  it, so they can never disagree. Games don't report a level — they just bank
  stars; `setLevelHidden(true)` suppresses the badge in special modes (e.g.
  slingshot's authoring editor).
- `progress.ts` — persists per-game adaptive skill meters and reward stars in
  `localStorage` and is observable (`subscribeProgress`); see "Progress: skill,
  levels, stars" below.
- `pixel/` — the **pixel pad**, the one piece of shared game-facing UI. It is
  shared rather than owned by the drawing game because its first consumer opens it
  as an overlay over a running Phaser scene: the `/drawing` route is a thin studio
  shell around the same component. `grid.ts` is pure (Bresenham, stroke undo,
  base64), `artStore.ts` is the child's gallery in `localStorage` queried by
  `(role, tag)`, and `drawingTexture.ts` is the single place a saved drawing
  becomes something a Phaser game can draw. See `docs/designs/drawing-pixel-studio.md`.

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
    level.ts            single source of visible level (stars + 1 → badge + tile)
    progress.ts         adaptive skill meters + reward stars (localStorage)
    pixel/              the shared pixel pad (opens over any game)
      PixelPad.tsx      the instrument: canvas, rail, undo, done
      grid.ts           pure: Bresenham, stroke undo, encode/decode
      palette.ts        the 15 colours + paper
      layout.ts         pure proportional pad/rail geometry
      artStore.ts       the gallery in localStorage, queried by (role, tag)
      drawingTexture.ts Drawing → NEAREST canvas texture for Phaser
  games/
    registry.tsx        SINGLE SOURCE OF TRUTH for games
    drawing/            the pixel studio (Canvas 2D, wraps shared/pixel)
      DrawingGame.tsx
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
5. Set `leveled: true` on the game's registry row and bank one reward star per
   level passed with `addStars(GAME_ID)` from `shared/progress.ts`. That is the
   whole level system: the standardized badge (next to home) and the launcher
   tile both show `stars + 1` from `shared/level.ts` — one number, always in
   sync, no per-game reporting. Free-play games (no levels) omit `leveled` and
   carry no badge.

## Rendering rules

- Never drive per-frame animation from React state. Use `requestAnimationFrame`
  (Phaser does this for you) or imperative Canvas draws in event handlers.
- Design for touch: large targets, no hover, no right-click, pointer events
  (one code path for touch + mouse), `touch-action: none` on drawing surfaces.

## Progress: skill, levels, stars

`shared/progress.ts` persists per-game state in `localStorage`. Three decoupled
currencies:

- **Skill** — invisible and adaptive, on as many named axes as a game has genuinely
  different skills. Games save the meter every round and start each session below
  the saved value via `sessionStart()` (warm-up + break decay), then climb back
  faster while below the saved peak. Feed the Monster runs three: `cognitive`
  (which task kinds are in rotation and how hard they run), `belt` (conveyor speed
  and how long the child may wait, moved by missed passes), and `thief` (how fast
  the bird flies in, and how long it pecks before it takes off with the food —
  moved by whether the child caught it). Separate axes are the point —
  a child can be great at colours and bad at timing, and one meter would average
  the two into a difficulty that fits neither.
- **Levels** — the visible reward rhythm, derived (not stored): `shared/level.ts`
  computes `levelFor(gameId) = stars + 1`, read live by both the in-game badge
  and the launcher tile so they always match. Uniform rule in every game:
  passing a level (the game's own unit — solved round, bopped critter, cleared
  board) banks one star via `addStars()`, which ticks the number +1 everywhere.
- **Stars** — forever; the count the level is derived from.

Celebrations are pure animations on per-game `CELEBRATION_EVERY_*` beats. See
`docs/DECISIONS.md` ("Progress: two-axis adaptive skill").

## Round modes (Feed the Monster)

Feed the Monster has grown past "one tray, one friend", and the pattern that keeps
it maintainable is a **self-contained mode widget** the scene delegates to, leaving
the polished solo flow untouched. `duoMode.ts` set the shape; `conveyorMode.ts`,
`kitchenMode.ts` and `thiefMode.ts` follow it. Each one owns its own display
objects, reads live scene state through the passed `this`, and reuses the shared
`Tray` for anything draggable — so the drag mechanics, the magnetic snap and the
feed handoff exist once.

A mode plugs into the tray through three seams rather than reimplementing food
motion: `homeProvider` (where a released food belongs — for the conveyor, a plate
that is still riding), `returnHome` (send a food back when no `dragend` will,
e.g. a belt dish that was tapped rather than dragged) and `isAnimating` (do not
reposition a food the tray is already flying). `arcTo` accepts a live target, so
"arc home" works when home is moving.

Every decision a mode acts on lives in a **pure, unit-tested sibling**:
`session.ts`, `belt.ts`, `recipes.ts`, `thief.ts`, `journey.ts`, `logic.ts`. The
widget draws; the sibling decides. That split is what lets a mode's adaptive curves
and no-fail guarantees be proven over hundreds of seeds without a browser.

### Three axes, kept apart

1. **Variety — which MODE** (`session.ts`). Classic / conveyor / kitchen / duo,
   dealt as a session **setlist**: a classic warm-up, then alternating
   `special block → classic breather`, with specials drawn from a weighted deck
   **without replacement** and never repeating back to back. Reads the episode (an
   unlock ladder) and nothing else — deliberately not the difficulty meter.
2. **Difficulty — which ASK** (`logic.ts`). `TASK_REGISTRY` over the 0..12
   cognitive meter, plus the belt's and the thief's own short meters.
3. **Sprinkles** — the big bite (`journey.growAmount`) and the thief
   (`thief.shouldVisit`), layered onto any mode on their own variable schedule.

Blocked modes, interleaved tasks, on purpose: blocked practice gets a child to
competence on a new _interaction_ faster, interleaved practice is what makes the
_learning_ stick. A mode is an interaction; the ask under it is the learning.

How a round reaches the stage:

1. `startRound` lets the commission (a once-per-episode journey beat) pre-empt
   everything, then asks the setlist for this round's mode — one call, one answer.
2. `dealRound` generates through `logic.generateRound`. A kitchen round forces its
   task kind (`logic.kitchenKind`); every other mode takes the meter's rotation.
3. `presentRound` puts it on stage. **Every** path that deals a round goes through
   this one function — the normal loop, the dev/e2e `forceKind`, the commission's
   own round — so a mode can never be left half-dressed.

Cooking IS a mode. `dish` / `dish-ordered` used to be rows in
`logic.TASK_REGISTRY`, which made the two axes fight: the pot could only get more
frequent by taking rounds away from counting and colours, and it could not appear at
all until the meter reached 5. It is a deck card now; its _difficulty_ still rides
the meter, through `dishMaxIngredients` and `DISH_ORDERED_MIN_SKILL`.

**Two panels, one per ask.** A kitchen round is the only round that carries two
instructions, so it draws two task panels and each hangs over the thing it is
about: the friend's bubble (`requestBubble.ts`, top bar) shows only the finished
dish — an ordinary one-item request — while the pot carries its own panel with the
recipe as an equation, `part + part … = dish` (`recipePanel.ts`, owned by
`kitchenMode`). A non-reader can only tell two instructions apart if they are in
two places. The recipe panel is keyed off a `Recipe`, never off a round, and its
progress is driven by the pot's contents, so a pot that later stays on stage across
rounds is re-tasked with `kitchenMode.setRecipe` and the panel needs no rework.
`layout.recipePanel` solves where it goes: it hugs the pot on whichever side has
room (above by default, below when above cannot hold the equation legibly) and
derives the tile size from the free width beside the friend, so four ingredients
still read on the narrowest viewport.

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

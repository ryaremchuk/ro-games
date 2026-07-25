# Design — Pixel Studio (the drawing game, rebuilt)

> Status: **draft**, awaiting the design conversation.
> Adds: fine motor precision on a grid, colour choice, and — the real prize —
> **art the child makes that other games then use**.

## The pitch

The drawing game stops being an infinite crayon canvas and becomes a **pixel
studio**: a square grid of big fat cells the child paints one at a time. One
brush (exactly one cell), a palette of colours, an eraser, and a switch between
**16×16 / 32×32 / 64×64**.

Everything the child paints is saved as a tiny grid of colour indices — which
means it is a **sprite**. And a sprite can walk into any other game in this app:
a balloon printed with the child's face, a critter that pops out of a hole, a
food the monster eats, a card in the memory game.

That second half is what this design is really about. The studio is the easy
part; the pipeline that lets a 4-year-old draw a fish in the morning and feed it
to the monster in the evening is the interesting part.

## Why this one

Free-form drawing is the one game in the app with **no adaptive axis at all** —
there is nothing to get better at, nothing measures the child, and nothing the
child makes survives the next tap on 🗑️. It is the weakest game against the
north star.

A grid changes that on three counts:

1. **It has a precision axis.** 16 → 32 → 64 is a real, measurable ladder of
   fine motor control (cell size halves each step). It is the same shape as
   whack-a-silly's hole count: a second difficulty track that the child can see
   and choose.
2. **It has a shared vocabulary with the rest of the app.** A grid of colour
   indices is a sprite; a smear of freehand strokes is a photograph of a smear.
   Only the first one can be reused.
3. **It gives the app a reason to _ask_ the child for something** ("the monster
   wants a new food — draw one"), which turns open-ended play into a goal-driven
   loop without ever putting a score on it.

**Gameplay impact:** the studio itself stays 100% no-fail free play (pacing is
the child's, there is no clock and nothing to lose), so the risk is not
frustration but boredom — a blank grid with no prompt is a shorter session than
a blank page with crayons, because pixels are slower to fill than strokes. The
fix is the commission loop (below): the studio should almost always open with
_something someone asked for_ waiting on it, while still allowing a blank page.
The other risk is precision: at 64×64 a cell is ~2 mm on an iPad, well under
what a 4-year-old can hit reliably, so 64 must never be the default and undo has
to be one big obvious button.

## Research notes

- **Touch targets for young children want ~2 cm.** NN/g recommends at least
  2 cm × 2 cm for young children — four times the adult 1 cm guideline — and
  notes 10 mm beats 7 mm while 4 mm is "sort of a disaster"
  ([NN/g — design for kids by physical development](https://www.nngroup.com/articles/children-ux-physical-development/),
  [NN/g — touch target size](https://www.nngroup.com/articles/touch-target-size/)).
  → No grid we can fit on an iPad reaches 2 cm per cell (see the table below).
  This is survivable only because **painting is not tapping**: a wrong cell
  costs one cell, is visible instantly, and is undone by dragging back over it.
  It still means 16×16 is the default and the toolbar buttons — not the cells —
  carry the 2 cm rule.
- **4-year-olds are already fluent with the gestures**, including drag; the
  accuracy gap versus older children is concentrated in the final approach to a
  small target
  ([Frontiers — toddlers using tablets](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.564479/full),
  [Fitts' law performance of preschoolers, UMD](https://api.drum.lib.umd.edu/server/api/core/bitstreams/6f012eb1-196c-4014-8a34-a031c977deaf/content)).
  → Continuous dragging across cells is the primary input; single precise taps
  are the fallback, not the other way round.
- **Pixel/grid colouring is an established preschool genre** and is sold on
  exactly the axes we care about — focus, spatial awareness, fine motor control,
  colour discrimination
  ([Twinkl on pixel art templates](https://www.twinkl.com/blog/pixel-perfect-exploring-creativity-with-pixel-art-templates),
  [Kids Pixel Art Coloring Games (ages 3–5)](https://play.google.com/store/apps/details?id=com.KidsFreeGames.coloring.pixel.art.tangram.puzzles.toddlers)).
  Note what those apps actually ship: mostly **colour-by-number on a prepared
  outline**, not a blank grid. That is a hint about attention span, and it is
  the direct ancestor of our "trace" commissions.
- **"Your drawing becomes the game" is a proven hook, and always mediated.**
  _Drawn to Life_ (DS) had the player draw the hero and props, which then became
  the actual in-game sprites, but only ever into **pre-defined slots** with
  known semantics — the game knew it was asking for "a hero", so it could
  animate it ([Drawn to Life](<https://en.wikipedia.org/wiki/Drawn_to_Life:_The_Next_Chapter_(Nintendo_DS_video_game)>)).
  Pixicade and Draw Your Game photograph a paper drawing and convert it into a
  playable level by **colour-coded convention** — red is a wall, blue is water —
  again, meaning supplied by the frame, not inferred from the art
  ([Pixicade](https://www.abacusbrands.com/products/pixicade),
  [Draw Your Game](https://www.draw-your-game.com/)).
  → Confirms the central constraint of part 2: **we can never guess what the
  child drew.** Every reuse path must either not care what it is, or have asked
  for it.

## Part 1 — the studio

### It is a component first, a game second

**Decided.** The pad is built as `shared/PixelPad.tsx` —
`{ size, askColor?, template?, onDone(drawing | null) }` — and the `/drawing`
route is a thin wrapper that adds the grid-size buttons and the gallery around
it. Everything else in this app that ever wants a drawing mounts the same
component as an overlay.

This is not speculative generality: the first consumer
([drawn food in Feed the Monster](feed-the-monster-drawn-food.md)) needs the pad
to open **over a running Phaser scene**, with no route change and no lost game
state. Building the pad inside the route first would mean pulling it back out
immediately.

### Layout

A square canvas, centred, as large as the shorter viewport axis allows, with a
single tool **rail** on the long side (left on both aspect ratios, so muscle
memory transfers; the shell's back/level chrome stays where it is).

Everything proportional, per house rules: `side = min(vh × 0.92, vw × 0.62)`
subject to the rail's minimum width, with the rail's buttons sized off `vmin`
and never below the physical 2 cm minimum.

### Cell size is the whole design constraint

Approximate cell sizes for a fit-to-screen canvas (iPad 10.2" ≈ 5.2 css px/mm;
iPhone-landscape ≈ 5.9 css px/mm):

| Grid  | iPad, ~720 px canvas | iPhone-landscape, ~350 px canvas |
| ----- | -------------------- | -------------------------------- |
| 16×16 | 45 px ≈ **8.7 mm**   | 22 px ≈ 3.7 mm                   |
| 32×32 | 22 px ≈ **4.3 mm**   | 11 px ≈ 1.9 mm                   |
| 64×64 | 11 px ≈ **2.2 mm**   | 5 px ≈ 0.9 mm                    |

Conclusions we should design to rather than fight:

- **The iPad is the target device** for this game (it is the installed PWA);
  iPhone-landscape must stay usable and pleasant, but 64×64 there is a novelty,
  not a workflow.
- **16×16 is the default, always.** It is the only setting that is comfortable
  everywhere, and it is the size that reuse actually wants (see "Data model").
- **No zoom, no pan.** Pinch-zoom is disabled app-wide by design, and a pan mode
  is one concept too many for a non-reader. The canvas is always fully visible.
  64×64 is "detail mode for a steady hand", and that is fine.
- Because cells are small relative to a fingertip, **cell highlight under the
  finger** (a soft ring on the cell that _would_ be painted, offset above the
  contact point) is worth prototyping on 32/64.

### Tools (v1 scope, exactly as requested)

| Tool          | Behaviour                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Brush         | Always 1 cell. Tap paints one; drag paints every cell the path crosses.                        |
| Eraser        | Same 1-cell brush, paints "paper" (= transparent). Toggles with the palette, exactly as today. |
| Colour        | Fixed palette of 15 swatches + paper. No colour picker, no hex, no recents.                    |
| Grid size     | Three big buttons: 16 / 32 / 64.                                                               |
| Undo          | One button, no redo. One **stroke** (pointer-down → up) = one step, depth 20.                  |
| New page (🗑️) | Clears — but first auto-files the current drawing into the gallery if it is not blank.         |

Deliberately **not** in v1, in rough order of how much I would want them later:
bucket fill (very satisfying, one function, likely v1.1), mirror/symmetry mode
(makes anything look good — strong candidate), eyedropper (redundant, the
palette is right there), lines/shapes, layers, zoom, redo, free colour picking.

### Implementation notes that matter

- **Bresenham between pointer samples.** A fast drag on a 64 grid skips cells
  otherwise; this is the single most common way a pixel editor feels broken.
- **Paint-once per stroke.** A cell already painted by _this_ stroke is not
  repainted when the finger wanders back over it (no flicker, and it makes
  stroke-level undo exact).
- **Paper, not white.** The empty cell renders as a warm paper colour, but is
  stored as `transparent`. The child never sees a checkerboard; the export gets
  correct alpha, which every reuse path needs. This is the one place where what
  the child sees and what we store deliberately differ.
- **Render**: one `<canvas>` at `grid × grid` backing pixels, drawn 1 px per
  cell, upscaled with `image-rendering: pixelated` / `imageSmoothingEnabled =
false`. No per-cell DOM, no hi-DPI scaling maths — the grid _is_ the bitmap.
  Grid lines are a separate overlay canvas so they never contaminate the data.
- **Audio**: a short soft tick per newly painted cell, pitch stepped by palette
  index, hard-throttled (≥ 40 ms apart) so a fast drag does not machine-gun.
  Distinct lower tick for the eraser — the game already uses this convention.
- **Changing grid size does not destroy work**: the current drawing is filed to
  the gallery first, then a fresh page of the new size opens. (Resampling 16→32
  is tempting and wrong — it produces art the child did not make.)

### No-fail rules

- Nothing is ever lost: every non-blank page is filed on clear, on size change,
  on navigating away, and on `visibilitychange`.
- There is no "wrong" pixel and no scoring, ever, in free play.
- Undo is always available and never greyed out into uselessness — when the
  stack is empty it is simply inert (no error sound).

## Part 2 — the drawings come alive (the brainstorm)

This is the part to argue about. Below is the framing I would defend, then the
concrete menu.

### The one hard constraint

**We cannot know what the child drew.** Two paths only:

- **Decorative reuse** — the game does not care what it is. A print on a
  balloon, a sticker on the launcher tile, a poster on a wall, confetti. Works
  with any drawing, needs zero metadata, ships tomorrow.
- **Commissioned reuse** — the game _asked_ for a specific thing, so the result
  is tagged by construction. "Draw a food for the monster" → the saved sprite
  carries `role: 'ftm-food'`, and the monster can eat it because it was made to
  be eaten.

There is a cheap third path worth noting: we can extract **objective** facts
from any bitmap without understanding it — dominant colour, colour count, filled
fraction, bounding box, rough symmetry. That is enough to use an untagged
drawing in a colour-matching or odd-one-out task ("find the blue one" works even
if the blue thing is an unidentifiable blob). Nice trick, low cost, real
learning value.

### Tier 1 — decorative (ship first, no new concepts)

| Game             | Slot                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| Launcher         | The child's newest drawing as the drawing tile's face, instead of 🖍️.             |
| Balloon Pop      | Some balloons carry the drawing as a print; popping it shows it whole for a beat. |
| Whack-a-Silly    | A rare bonus "critter" that is the child's drawing on a stick.                    |
| Slingshot        | The drawing printed on a target block.                                            |
| Memory           | A pair of cards using the child's own drawings (instant difficulty spike — they   |
|                  | are less distinguishable than authored art, so cap it at one pair per board).     |
| Feed the Monster | Framed drawings on the background wall of the room.                               |

All of these are "sprite in a slot" and share one loader. That is the whole
technical cost of tier 1.

### Tier 2 — commissions (the real feature)

A game runs out of something and **asks the child to draw it**. The ask arrives
as a picture, never text: the monster holds up an empty plate; a hole in
whack-a-silly is empty with a question-mark puff.

The commission opens the studio with:

- the **right grid size** for the slot (16 for food, 32 for a critter),
- an optional **ghost template** — a faint outline the child can colour inside
  or ignore entirely (this is the colour-by-number genre the research points at,
  and it is our adaptive dial),
- a **done** button that hands the sprite straight back to the requesting game,
  which then immediately uses it: the monster eats the drawn food on the spot.

That last beat — _draw it, then watch it get used within five seconds_ — is the
entire emotional payload. It should be the first thing we build after the
studio.

Commission candidates, cheapest first:

1. **Feed the Monster — a food.** ✅ **Decided as the first one to build**, and
   written up in full as its own design:
   [Feed the Monster: the food the child drew](feed-the-monster-drawn-food.md).
   16×16, the _colour_ is the ask (so the sprite is tagged by construction),
   eaten immediately with the celebration turned up, then it lives in the food
   rotation and the friend later asks for it by name.
2. **Whack-a-Silly — a critter.** 32×32, pops from a hole among the others.
3. **Balloon Pop — a balloon print.** 16×16, decorative but commissioned so it
   feels answered.
4. **Odd One Out — draw the odd one.** Interesting inversion: the game shows
   three of something and asks the child to draw the one that does not belong.
   No way to grade it, and that is fine — the _thinking_ is the exercise.
5. **Slingshot — draw the thing to knock down.** Needs a physics body; a plain
   box body under the sprite is enough.

### Tier 3 — the gallery as a place

A "fridge door" screen (reachable from the studio, maybe from the launcher):
every drawing the child has made, tiled, tappable to re-open. Long-term this is
where a child sees their own history — the strongest motivator in the app that
costs no cleverness. Also the natural place for a delete affordance for the
parent.

### Adaptive difficulty

Free play stays free. The adaptation lives in **which commission arrives** and
**how much scaffold it carries** — one new meter, `precision`:

| Dial              | Range                                             | Driven by   |
| ----------------- | ------------------------------------------------- | ----------- |
| Commission grid   | 16 → 32 → 64                                      | `precision` |
| Ghost template    | full outline + colour dots → outline only → blank | `precision` |
| Template subject  | 4–6 filled cells (a ball) → 30+ (a fish)          | `precision` |
| Default grid size | the size the child last succeeded at              | `precision` |

`precision` is measured, invisibly, from things the studio already knows:
cells painted per stroke, correction rate (cells painted then erased or undone
within a few seconds), and — when a ghost template is present — the fraction of
painted cells that landed inside it. That last one is a genuinely good signal
and costs nothing.

The three size buttons are **never locked**. Locking a button a child can see is
the fastest way to make them press it repeatedly and get nothing; the adaptation
picks the _default_, not the ceiling.

### Data model & storage

The saved unit is a grid, not a PNG — small, diffable, re-renderable at any
scale, and inspectable in tests:

```ts
interface Drawing {
  v: 1
  id: string // stable, also the texture key suffix
  w: number // 16 | 32 | 64
  h: number // === w for now
  palette: string[] // hex strings; index 0 is always transparent "paper"
  cells: string // base64 of w*h bytes, one palette index per cell
  createdAt: number
  /** Set only for commissioned art; absent for free play. */
  role?: 'ftm-food' | 'whack-critter' | 'balloon-print' | ...
  /**
   * What the commission asked for, when the ask carried a parameter — e.g. the
   * FoodColor for an `ftm-food`. This is the whole trick: the tag is true
   * because we asked for it, not because we recognised anything.
   */
  tag?: string
}
```

The store is queried by `(role, tag)`, newest first, which is enough for every
reuse path we have designed: "the newest thing the child drew" (decorative),
"the newest red food" (commissioned), "everything" (the gallery).

Sizes: 16×16 = 256 B raw → ~344 B base64; 64×64 = 4 KB → ~5.5 KB. A 100-drawing
gallery is well under a megabyte, so `localStorage` is fine (same store family
as `shared/progress.ts`, key `ro-games:art:*`, with the same
in-memory-fallback-on-quota behaviour).

Getting one into a Phaser game is ~15 lines and one shared helper: build an
offscreen canvas at `w × h`, write the pixels, `scene.textures.addCanvas(key,
canvas)`, set `FilterMode.NEAREST`, and scale the sprite up. No PNG encoding, no
async loading, no preload phase — which is why the grid format matters more than
it looks.

## Integration

| File                                    | Change                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/PixelPad.tsx` _(new)_       | The pad itself: `{ size, askColor?, template?, onDone }`. Shared, because it opens over other games as an overlay (see above).           |
| `src/games/drawing/DrawingGame.tsx`     | Becomes the studio shell around `PixelPad` (grid-size buttons, gallery entry). The freehand implementation is replaced — see question 1. |
| `src/games/drawing/grid.ts` _(new)_     | Pure: `Grid` type, `paintCell`, `line` (Bresenham), `strokeUndo`, `isBlank`, `encode`/`decode`. Fully unit-tested, no DOM.               |
| `src/games/drawing/palette.ts` _(new)_  | The 15 colours + paper. Exported, because other games will render these sprites.                                                         |
| `src/games/drawing/layout.ts` _(new)_   | Proportional canvas/rail geometry, unit-tested at 4:3 and ~2.2:1.                                                                        |
| `src/games/drawing/testHook.ts` _(new)_ | `{ grid, size, color, eraser, cellRects }` so e2e can paint real cells with real pointer drags.                                          |
| `src/shared/artStore.ts` _(new)_        | The gallery: save/list/load/delete `Drawing`s in `localStorage`, query by `(role, tag)`, subscribe on change. Mirrors `progress.ts`.     |
| `src/shared/drawingTexture.ts` _(new)_  | `Drawing → HTMLCanvasElement` and `registerDrawingTexture(scene, drawing)`. The one place every consuming game goes through.             |
| `src/games/registry.tsx`                | Unchanged for v1 (`drawing` stays non-leveled). The precision meter is saved via `progress.ts` `skill`, which needs no registry change.  |
| Consuming games                         | One slot each, added one at a time — nothing lands in a game until the studio and the store are shipped and stable.                      |

## Art

**No new art files.** The palette is code, the canvas is code, the rail buttons
are emoji/procedural like the current toolbar. The ghost templates for
commissions are authored as `Drawing` records (i.e. we draw them in our own
studio and paste the encoded string into a fixture) — which is a nice
dogfooding test of the format.

## Test plan

- **Unit (`grid.test.ts`)** — Bresenham covers every cell on steep/shallow/
  diagonal drags with no gaps and no duplicates; paint-once per stroke; undo
  restores exactly the pre-stroke grid across a random seeded sequence;
  `encode`/`decode` round-trips every grid size; `isBlank` is exact.
- **Unit (`layout.test.ts`)** — the canvas is square, fully on screen, and never
  overlaps the rail or the shell chrome at 4:3 and ~2.2:1; rail buttons clear the
  2 cm minimum on an iPad.
- **Unit (`artStore.test.ts`)** — save/list/delete, quota failure falls back to
  memory, corrupt JSON is skipped rather than throwing (per the setup in
  `src/test/setup.ts`).
- **E2E (`drawing.spec.ts`)** — a real pointer drag across the canvas paints a
  contiguous run of cells (asserted through the test hook, not pixels); the
  eraser clears them; undo restores them; switching 16→32 files the drawing and
  opens a blank page; the filed drawing appears in the store.
- **Device** — 16/32/64 all painted by an actual 4-year-old finger on the iPad
  before we call the precision ladder real.

## Open questions for the design session

1. **Does the freehand canvas survive?** Recommendation: **no** — one mode, no
   mode switch for a non-reader, and freehand produces nothing reusable. But it
   is the mode the child already knows, and paper does not have an undo button.
   A two-tile split (🖍️ freehand / ▦ pixels) as two separate launcher entries is
   the compromise if we want both.
2. ~~**Which reuse ships first?**~~ **Settled: the Feed the Monster commission**
   — "draw a food → the monster eats it now" is the moment that sells the whole
   idea. Written up as [drawn food](feed-the-monster-drawn-food.md); the
   decorative tier-1 slots come after it, one at a time.
3. **Where does the gallery live?** Inside the drawing game only, or as a fourth
   launcher tile ("the fridge door")?
4. ~~**How does a commission reach the child?**~~ **Settled for the first
   consumer: pushed** — the pad opens over the game with the ask already on it,
   at a journey beat the game picks. A pull affordance (tap the empty plate) can
   come later if the child ever dismisses one and wants back in.
5. **Palette size** — 15 colours is a lot of rail; 8 (today's set) is fast to
   scan but limits what a drawing can be. Also: do we include a skin-tone and a
   "shadow" pair, which are what make pixel art read?
6. ~~**Do commissioned drawings persist forever?**~~ **Settled: forever, but
   capped** — six food slots, one per colour, newest per colour wins and the
   retired one stays in the gallery. The cap is what stops the tray degrading
   into blobs.
7. **Parental controls** — is there any need to delete/hide a drawing, and if so
   where does that live so a 4-year-old does not find it?

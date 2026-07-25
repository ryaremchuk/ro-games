# Design — Feed the Monster: the food the child drew

> Status: **draft** — the shape below is agreed; the open questions at the end
> are not.
> Adds: **production instead of selection** — the first task in the app where the
> child _makes_ the answer rather than picking it.
> Depends on: [Pixel Studio](drawing-pixel-studio.md) (the `PixelPad` component
> and the art store).

## The pitch

A new friend arrives holding an **empty plate**. Its thought bubble shows a
pencil and a colour blot: _draw me something **red**_.

A 16×16 pixel pad slides up over the scene. The child paints whatever a red
thing is to them. **Done** → the drawing flies onto the tray as a food, and the
friend eats it on the spot, with a bigger reaction than any normal bite gets.

From then on that drawing **is** a food in this game: it sits in the rotation,
it turns up in colour rounds, in count rounds, in mixes — and a few rounds later
the friend asks for it **by name**, the way it asks for an apple.

## Why this one

Every task kind in `logic.TASK_REGISTRY` — `single`, `count`, `color`, `dots`,
`combo`, `not`, `pattern`, `mix` — is the same verb: **look at the tray and pick
what matches**. Recognition, eight ways.

"Draw me something red" is a different verb. The child has to hold a colour
concept and **produce** an instance of it from nothing, with no options to choose
between. That is a step up from matching, not a variation on it, and it is the
only feature on the queue that adds a _productive_ task rather than another
receptive one.

It also solves the studio's problem — a blank grid with no prompt is a short
session — and the studio solves this feature's problem: we need art we
understand, and art we asked for is art we understand.

**Gameplay impact:** one commission per episode (roughly one per five feeds)
drops a quiet 1–3 minute making beat into a game that currently has exactly one
fast rhythm; that variety is the point, and the transition already _is_ a pause
(dance party) so it lands on an existing seam rather than interrupting a round.
The real risk is not difficulty but the **off-ramp** — a child can settle into
the pad and forget the monster — so the friend stays visible and impatient
behind the pad (peeking, drooling), **done** is the loudest thing on screen, and
the eat happens immediately with no transition in between. Leaving the pad blank
costs nothing: the plate fills with an ordinary food and the round proceeds.

## Why the colour is the ask

The central constraint from the studio design: **we can never know what the child
drew.** But `Food` does not need to know:

```ts
export interface Food {
  id: string
  emoji: string
  color: FoodColor // 'red' | 'yellow' | 'green' | 'orange' | 'purple' | 'brown'
}
```

Colour is the only attribute the game reasons about — and if the _request_ names
the colour, the answer is tagged by construction. No classification, no image
analysis, no guessing, and the child's drawing enters `color` / `mix` / `not`
rounds as a first-class citizen on day one.

The ask doubles as the learning content: "draw something red" is a harder colour
exercise than "give me the red one", because nothing red is on screen to copy.

### Before colours are on the table

`color` rounds unlock at cognitive meter 2. Below that the ask is simply **"draw
anything"**, and we take the drawing's **modal colour** — every painted cell
snapped to the nearest of the six `FOOD_ACCENT` hexes, most common bucket wins,
paper ignored — as its colour.

That is unreliable for a rainbow blob, and it does not matter: at meter < 2 the
child is not getting colour rounds yet, and by the time they are, every drawn
food in the pool was commissioned with an explicit colour.

> Rejected alternative: a `colorConfident` flag that excludes low-confidence
> drawings from colour rounds. It sounds more honest, but it forces every
> colour-picking generator to filter the pool, which puts the "every window has
> every colour" satisfiability invariant at risk for a case that cannot arise in
> practice. Not worth it.

## The mechanic

### When a commission arrives

At the arrival of the **first friend of an episode**, starting from **episode
2** — so the child has fed five friends and seen one full dance-party transition
before the game ever asks them to make something. One per episode, never two.

### Which colour is asked

**The colour the child does not own yet**, in `FoodColor` order; once all six are
owned, the oldest slot is refreshed. So the ask has a reason the child can feel
("there is nothing brown here") and, over a few sessions, they end up owning
**one food of every colour** — a collection that fills itself.

### The beat, in order

1. New friend walks in with an **empty plate** instead of a request bubble.
2. The bubble opens with ✏️ and a **blot of the asked colour**, held for a moment
   so the colour registers.
3. The **pad slides up** — 16×16, full palette, one brush, eraser, undo. The
   friend stays visible above it and gets visibly impatient.
4. **Done** → the pad slides away, the drawing arcs onto the plate, and the
   friend eats it with the celebration turned up (big chomp, confetti, an aura
   pulse a step brighter than a normal feed).
5. The drawing joins the episode's food pool. The round loop resumes as normal.
6. **A few rounds later the friend asks for it specifically** — an ordinary
   `count` request whose `foodId` is the drawn food. Zero new mechanics; the
   generator is nudged once. This is the emotional payoff and it costs nothing.

### The pad is never a trap

- Closing the pad with a blank grid: no reaction, no sad sound. The plate fills
  with an ordinary food and the game continues. The commission is retried next
  episode.
- The pad has no timer and no round counter running behind it.
- The drawing is filed to the gallery whether or not it becomes a food.

## Keeping the food pool legal

`logic.FOODS` and every `Episode.foods` are deliberately **three full six-colour
cycles (18 foods)** so that any `ACTIVE_POOL_SIZE`-wide window at any rotation
contains every colour — `logic.test.ts` sweeps every shift to prove colour /
mix / not rounds stay satisfiable. Appending a 19th food breaks that by
construction.

So drawn foods **substitute, they do not append**:

```
withDrawnFoods(episodeFoods, drawn): Food[]
  // for each drawn food, replace the FIRST entry of the same colour
```

The result is still three full cycles, still 18 long, still one of each colour
per window — the invariant holds by construction, and the existing sweep test
extends to cover it for free. The child's red thing simply takes the apple's
seat.

### The drawn food's identity

```ts
{ id: `drawn-${drawingId}`, emoji: '✏️', color: <the asked colour>, drawingId }
```

`emoji` stays required and becomes the **graceful fallback** — exactly the
philosophy `art.ts` already follows, so a drawing whose texture failed to
register still plays as a food rather than crashing a round. Renderers prefer
the drawing texture whenever `drawingId` is set.

### Persistence and the cap

**Six slots, one per colour**, stored as `Drawing` records with
`role: 'ftm-food'` and `tag: <colour>` in the shared art store — no numeric
squeeze into `progress.ts` `data` (which only holds numbers), and no second
store. A new drawing of a colour retires the previous one _from the game_; it
stays in the gallery forever.

The cap is a learning decision, not a storage one: an uncapped pool slowly
replaces recognisable food with blobs, and then "give me the two yellow ones"
stops teaching anything.

## Adaptive difficulty

The commission is **not** a task-registry row — it is a journey beat (one per
episode), so it does not compete with the round generator. What adapts:

| Dial               | Range                                                   | Driven by             |
| ------------------ | ------------------------------------------------------- | --------------------- |
| The ask            | "draw anything" → "draw something \<colour\>"           | cognitive meter (≥ 2) |
| Pad grid           | 16×16, fixed                                            | —                     |
| Favourite callback | once, a few rounds later → recurring across the episode | cognitive meter       |
| Commission at all  | from episode 2                                          | journey               |

16×16 stays fixed for food: a tray food renders small, and the precision ladder
(32 / 64) belongs to the studio's own commissions and to bigger slots like a
whack-a-silly critter. Food does not need more pixels.

## Integration

| File                                              | Change                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/PixelPad.tsx` _(new, studio design)_      | The pad as a reusable component: `{ size, askColor?, onDone(drawing \| null) }`. The `/drawing` route is a thin wrapper around it — see the studio design.                 |
| `shared/artStore.ts` _(new, studio design)_       | Query by `role` + `tag`; newest wins per tag.                                                                                                                              |
| `shared/drawingTexture.ts` _(new, studio design)_ | `Drawing → canvas → scene.textures.addCanvas` at `NEAREST`.                                                                                                                |
| `logic.ts`                                        | `Food.drawingId?`, `withDrawnFoods()`, `dominantColor()` (pure, over a `Drawing`), and the one-line nudge that makes a drawn food the next `count` target.                 |
| `journey.ts`                                      | `commissionFor(journey, ownedColors)` → `FoodColor \| null`. Pure, unit-tested: episode ≥ 2, once per episode, missing colours first, then oldest.                         |
| `FeedTheMonsterScene.ts`                          | Emits `commission` at the first-friend-of-episode beat, soft-locks input while the pad is open (same rule as our own transitions), registers drawn textures in `create()`. |
| `FeedTheMonsterGame.tsx`                          | Renders `<PixelPad>` as an overlay above the Phaser canvas on the `commission` event; hands the result back to the scene.                                                  |
| `tray.ts` / `requestBubble.ts`                    | Draw a drawn food from its texture instead of the emoji glyph. The bubble showing the child's own art is a deliberate highlight — check how 16×16 upscales at bubble size. |
| `testHook.ts`                                     | `commission: { color, open } \| null`, `drawnFoodIds: string[]`, plus `submitDrawing(cells)` so a spec need not paint 40 cells by hand.                                    |
| `FeedDevPanel.tsx`                                | A "commission now" button and a "wipe drawn foods" button.                                                                                                                 |

## Art

**None.** The pad is DOM, the palette is code, the ask is ✏️ plus a colour blot
drawn with `Graphics`, and the celebration reuses the existing confetti / aura /
chomp beats.

## Test plan

- **Unit (`logic.test.ts`)** — extend the existing rotation sweep: with 1…6
  drawn foods substituted, every window at every shift still contains all six
  colours; a drawn food is pickable by `color`, `count`, `mix` and `not`; trays
  stay satisfiable across seeds.
- **Unit** — `dominantColor()`: single-colour grid → that colour; blank → null;
  paper cells never win; ties are deterministic.
- **Unit (`journey.test.ts`)** — no commission in episode 1; exactly one per
  episode after that; missing colours are asked first; all six owned → oldest
  slot refreshed.
- **Unit (`artStore.test.ts`)** — newest per `(role, tag)` wins; retired
  drawings survive in the gallery.
- **E2E** — force a commission through the dev hook, submit a synthetic drawing,
  assert the food lands on the tray, can be dragged into the mouth, and completes
  the round; assert closing the pad blank leaves the round playable and the tray
  whole.
- **Device** — a real 4-year-old draws one, feeds it, and is asked for it again
  in the same session. If that callback does not get a reaction, the feature is
  not finished.

## Open questions

1. **Does a drawn food get the big-bite boost** (`BIG_BITE_FOOD_BOOST`) when the
   friend asks for it later, or is the extra celebration confined to the first
   bite? Recommendation: first bite loud, later bites normal — otherwise the
   drawn food becomes the strictly-best food and the child stops engaging with
   the rest of the tray.
2. **Is the favourite callback guaranteed or random?** Guaranteed once per
   episode is legible; random is more alive. Recommendation: guaranteed the first
   time a drawing is ever made, random after.
3. **Does the child's art appear inside the request bubble**, or only on the
   tray? Art in the bubble is the stronger moment but 16×16 upscaled to bubble
   size may read as mush — settle it on the device.
4. **Restrict the pad's palette to the asked colour's family?** It would
   guarantee the drawing "looks red" and teaches shade. Recommendation: **no** —
   taking colours away is the one thing that makes a free-play pad feel like a
   test.
5. **Should other games see `role: 'ftm-food'` drawings** as decoration (a
   poster, a balloon print)? Cheap, and it makes the whole app feel like one
   place. Probably yes, later.
6. **What happens when the child draws nothing for several episodes in a row** —
   does the game stop asking? Recommendation: keep asking, once per episode; the
   ask is two taps to dismiss and the day they say yes is the day it works.

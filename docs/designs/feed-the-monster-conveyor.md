# Design — Food conveyor

> Status: **draft**, awaiting the design conversation.
> Adds: timing, response inhibition, sustained scanning of a moving stream.

## The pitch

The still row of eight plates is replaced, for that round, by a slow **kaiten
(conveyor-belt) sushi** loop along the bottom of the screen. Dishes ride past the
child. The friend still asks for something in the thought bubble; the child waits
for the right dish to come round, lifts it off the belt and feeds it.

Nothing is ever lost: the belt is a **closed loop**, so a dish that leaves one
edge comes back from the other. "I missed it" is not a failure state, it is a
few seconds of waiting.

## Why this one

Feed the Monster has no clock. Every existing task kind is solvable by staring at
a frozen tray for as long as you like, which means the game never trains the
child to _hold a goal while the world moves_. The conveyor introduces exactly
that, and it introduces it in the gentlest possible frame — a restaurant belt,
where waiting is the normal, expected thing to do.

Against the north star: it is a genuine new difficulty axis (belt speed, dish
density, how long the wanted dish takes to come round) that is orthogonal to the
cognitive meter, so a child who is fluent at colour-matching can still be
stretched, and a child who is struggling cognitively can meet the belt at its
slowest.

**Gameplay impact:** pacing gains a heartbeat the game currently lacks and
variety jumps a lot; the risk is frustration on two fronts — grabbing a moving
target (motor, not cognitive) and waiting for a dish that never seems to come.
Both are designed out below rather than tuned down.

## Research notes

- **Children need help at the END of a reach, not the start.** Studies of
  children's touchscreen pointing find Fitts' law models them well only up to the
  moment they _first enter_ the target; the accuracy collapse happens on final
  approach, and drag-and-drop movement time is dramatically worse than tap for
  4–6-year-olds ([Yadav et al. 2021](https://onlinelibrary.wiley.com/doi/abs/10.1002/hbe2.305),
  [FittsFarm, INTERACT 2019](https://dl.acm.org/doi/10.1007/978-3-030-29387-1_38),
  [Benda et al.](https://www.cise.ufl.edu/~brett.benda/files/FFittsLawForChildren.pdf)).
  → A _moving_ drag source would stack the two hardest things for this age group
  on top of each other. The design must remove motion from the drag entirely
  (see "Freeze rules"), keeping motion only in the _scan_.
- **Belt games are a solved fantasy for kids.** Conveyor-belt sushi titles all
  share the same read: watch the belt, take the plate you want, ignore the rest
  ([Conveyor Belt Sushi Experience](https://apps.apple.com/fr/app/id1543250693),
  [Sushi Go Round](https://jayisgames.com/review/sushi-go-round.php)). The mental
  model needs no explanation, which matters when the player cannot read.
- **Waiting is trainable at 3–4, in short scaffolded doses.** Inhibitory control
  develops fast across the preschool years and responds to game-shaped practice
  ([Nature Sci. Rep. 2015](https://www.nature.com/articles/srep14200),
  [Front. review 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10887659/)).
  Child-friendly go/no-go paradigms for this exact age dress the task as a
  concrete fantasy — catch the fish, don't catch the shark
  ([dance-mat protocol](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6805719/)).
  → Waits must be short and _bounded_ (see the anti-drought rule); an open-ended
  wait is not training, it is dead air.
- **Physical conveyor toys are sold for 3+** and are used for exactly this
  cause-and-effect / loading-unloading play
  ([Kodo Kids](https://kodokids.com/products/conveyor),
  [Lakeshore](https://www.lakeshorelearning.com/products/blocks-manipulatives/unit-blocks-accessories/block-play-conveyor-belt/p/LC202/)),
  so the affordance is age-appropriate off-screen too.

## The mechanic

### Layout

The belt occupies the same band the plate row uses today (`layout.trayY`), full
width, and runs **left → right** (the direction a Latin-alphabet reader scans;
worth a look on the device with a Ukrainian-speaking child — see open questions).
Dishes are spaced evenly and ride a straight line; the "loop" is implied, not
drawn — a dish leaving the right edge re-enters from the left.

Visible dish count is **derived from the viewport**, not fixed at 8: `floor(width
/ dishPitch)`, so an iPhone in landscape shows more dishes than a 4:3 iPad rather
than the same eight squeezed. `dishPitch` stays a fixed CSS size so a dish is the
same physical size on every device.

### Freeze rules (the anti-frustration core)

1. **Touching a dish lifts it off the belt.** From `pointerdown` it no longer
   moves with the belt — it is in the child's hand, exactly like a tray food
   today. All existing drag code applies unchanged.
2. **The belt eases to a stop while a dish is held**, and resumes when the dish
   is fed or returned. So the child can look up at the bubble, think, and aim
   without the rest of the stream escaping. Physically it reads as "the waiter
   pauses the belt for you".
3. **A returned dish rejoins the belt** at the nearest free slot (arcs back, same
   `Tray.arcTo` motion), never vanishes.
4. **The belt never moves during a spit-back, a celebration, or a transition.**

The moving part of the game is therefore only the _scan_. The grab, the drag and
the drop are as static as they are today.

### Anti-drought guarantee

The single rule that makes waiting safe:

> A dish the request currently wants must be **reachable within
> `MAX_WAIT_MS`** at all times.

Implemented as a pure scheduler in `belt.ts`: on every spawn decision it checks
how long until a wanted dish next passes the grab zone; if that exceeds the
budget, the next dish spawned is forced to be a wanted one. `MAX_WAIT_MS` is a
difficulty dial (see below), starting around 4 s and growing to ~9 s.

This is the same shape as `logic.shouldInjectDuo`'s anti-drought ramp: live data
in, deterministic decision out, seedable, unit-tested.

### Round completion

Unchanged. The request, the bubble, the ghosting, the spit-back, the big bite,
the growth — all identical. Only the _source_ of the food changes.

## Adaptive difficulty

The conveyor is a **round mode**, injected on its own data + chance axis exactly
like the duo bonus — never by the cognitive meter, so belt practice and task
difficulty scale independently.

| Dial                | Easiest                  | Hardest | Driven by     |
| ------------------- | ------------------------ | ------- | ------------- |
| Belt speed          | one full traverse ≈ 18 s | ≈ 9 s   | belt skill    |
| `MAX_WAIT_MS`       | 4 s                      | 9 s     | belt skill    |
| Wanted-dish density | ~1 in 3 dishes           | ~1 in 6 | belt skill    |
| Dish pitch          | roomy                    | tight   | fixed for now |

Open question: does the belt get **its own persisted meter** (a third axis
alongside `cognitive`, like whack's spatial track) or ride the existing one?
Recommendation: its own — a child can be great at colours and bad at timing, and
the whole point of the axis is to measure that separately.

Gating: unlocked from cognitive skill ≥ 4 (the child is past the basics), never
back-to-back, chance ramping with rounds-since-last exactly like the duo.

## Integration

Follows the `duoMode.ts` template — a self-contained mode widget the scene
delegates to, leaving the polished solo flow untouched.

| File                      | Change                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `belt.ts` _(new)_         | Pure: spawn scheduler, anti-drought guarantee, speed/wait curves, seedable. Unit-tested with no Phaser.                                                                                                                          |
| `conveyorMode.ts` _(new)_ | Phaser widget: belt sprites, dish motion, the freeze rules. Owns its display objects, reads scene state through `this.scene`.                                                                                                    |
| `logic.ts`                | `shouldInjectConveyor(ctx, rng)` beside `shouldInjectDuo`.                                                                                                                                                                       |
| `layout.ts`               | Belt geometry: `beltY`, `dishPitch`, `visibleDishCount(m)`, grab-zone bounds. Pure + unit-tested, proportional.                                                                                                                  |
| `tray.ts`                 | Gains a belt source mode, or `ConveyorMode` reuses `Tray`'s drag/arc/fade by handing it belt-derived slot positions. **Prefer reuse** — the drag mechanics, the snap assist and the feed handoff are already correct and shared. |
| `FeedTheMonsterScene.ts`  | `tryInjectConveyor()` next to `tryInjectDuo()`; `layout()` places the belt.                                                                                                                                                      |
| `testHook.ts`             | `conveyorActive`, dish list with css coords + `wanted` flag, `beltSpeed`; `forceConveyor()` dev/e2e hook.                                                                                                                        |
| `FeedDevPanel.tsx`        | "🍣 Conveyor" button.                                                                                                                                                                                                            |

## Art

### Reuse as-is (no new files)

- **All 49 food sprites** (`art/food-*.png`) — dishes carry existing food.
- **All 10 friends**, the four backgrounds, the face parts — unchanged.
- **`marker-<episode>.png`** — the per-episode doily already used as a plate can
  ride the belt as the dish under the food. Zero new plate art, and the belt
  automatically looks themed per episode.
- **`ftm-halo`** (procedural) — the big-bite glow works on belt dishes unchanged.

### New art needed

Small list on purpose. All tintable greyscale-ish so `episode.palette.table` can
theme them, which avoids four variants of each.

| #   | Name                       | What it is                                                                                                                               | Notes                                                                        |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `belt-strip`               | A horizontally **tileable** belt segment, top-down-ish 3/4 view: flat running surface with a subtle repeating tread, a darker front edge | Must tile seamlessly left↔right. Neutral light grey so it tints per episode. |
| 2   | `belt-roller`              | One end roller / drum cap, seen from the side                                                                                            | Mirrored for the other end.                                                  |
| 3   | `hatch`                    | The kitchen opening dishes emerge from: a simple arched doorway with a soft curtain                                                      | One neutral version, tinted per episode; sits at the belt's entry edge.      |
| 4   | `dish-shadow` _(optional)_ | Soft elliptical shadow under a dish                                                                                                      | Can be procedural instead — decide during build.                             |

That is **3 required sprites** (plus 1 optional). Everything else is reuse.

## Test plan

- **Unit (`belt.test.ts`)** — over hundreds of seeds: a wanted dish is always
  reachable within `MAX_WAIT_MS`; the loop never produces gaps or overlaps;
  speed/wait curves are monotone in skill; a round is always completable.
- **Unit (`layout.test.ts`)** — belt geometry proportional; visible dish count
  sane at 4:3 and at ~2.2:1; dishes never overlap the safe-area strip.
- **E2E** — belt advances; a dish is grabbable with a real pointer; the belt
  stops while held and resumes on release; feeding from the belt completes a
  round; the wanted dish arrives inside the budget; a returned dish rejoins.
- **Device** — iPad and iPhone-landscape: is the belt legible, is the grab
  comfortable, does the wait feel like anticipation or like dead air.

## Open questions for the design session

1. **Direction** — left→right or right→left? Worth trying both on the device.
2. **Own difficulty meter** or reuse the cognitive one? (Recommendation: own.)
3. **Does the belt replace the tray for a whole round, or only for some rounds?**
   Recommendation: whole round, injected like a duo — mixing a static tray and a
   belt inside one round would muddy both.
4. **Should the belt be a permanent EPISODE (a "sushi bar" theme with its own
   background and food pool) instead of a round mode?** That would give it a
   stronger identity and a natural home, at the cost of appearing much less
   often.
5. **Empty slots on the belt** — should there be gaps (a real restaurant belt has
   them, and they make the "wait" readable) or is it always full?
6. **Does a big-bite round on the belt slow it down** as an extra kindness, or
   stay at the round's normal speed?

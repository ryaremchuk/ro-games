# Design — Food conveyor

> Status: **SHIPPED** (`belt.ts`, `conveyorMode.ts`). Every open question below is
> answered at the end.
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
  (see "Lift rules"), keeping motion only in the _scan_ — by lifting the dish
  off the belt, not by stopping the belt.

  → And because nothing freezes on touch, the speed dial itself has to respect
  the child's reach: see "Grab fairness".

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

### Lift rules (the anti-frustration core)

> **Revised after the first play session.** It shipped with the belt easing to a
> stop while a dish was held. Ros played it and said the belt must move
> _constantly_ — a belt that halts stops being a belt, and a plate that vanishes
> with its dish reads as the machine losing pieces of itself. The freeze is gone;
> these rules replace it and are what make a never-stopping belt safe.

1. **Touching a dish lifts it clean off its plate.** From `pointerdown` it is an
   ordinary dragged object, exactly like a tray food. Because a lifted dish
   cannot slide out from under the finger, **no stop is needed to protect the
   drag** — which was the freeze's entire job.
2. **Its plate keeps riding, empty**, and is _claimed_: nothing else may be put
   on it. That is the better UI Ros asked for — the plate you took your food off
   is visibly still yours, going round with everything else.
3. **A dish let go without being fed always lands on a plate again**: its own
   whenever that plate is still in view, else the nearest free plate in view, else
   its own regardless (it rides back in through the hatch). Decided by the pure
   `belt.returnLane`, and it flies to a target re-read every frame, so it settles
   onto a plate that never stopped moving. A plain tap counts — that fires no
   `dragend`, so `ConveyorMode` puts it back itself.
4. **An eaten dish leaves its plate empty on the belt**; the plate refills only
   when it next rides through the hatch. Gaps riding past are the intended look —
   they are what tells the child the next one is coming.
5. **Nothing stops the belt. Ever.** Not a held dish, not a spit-back, not the
   celebration that ends the round. The only pause left in the code is the
   anti-drought _rescue_, which sits out a round-transition — and that injects
   dishes rather than stopping any.

The moving part of the game is therefore still only the _scan_. The grab, the drag
and the drop are as static as a still tray's.

### Grab fairness (why the speed dial is css px/s)

With nothing freezing on touch, the only thing protecting the grab is how long a
passing dish keeps its hit circle (a 50 css px radius, `layout.FOOD_HIT_RADIUS_CSS`)
over one point: `belt.grabWindowMs`. That number depends on **px/s and nothing
else** — so the dial is a physical speed, not a time-to-cross. A time-to-cross
dial made the belt 50% faster on a wide iPad than on a phone in landscape (same
seconds, more dishes crossing them), i.e. a different grab difficulty per device,
which a fixed-size dish must not have.

| Belt skill | Dish speed  | Grab window | Traverse (6 dishes / 9 dishes) |
| ---------- | ----------- | ----------- | ------------------------------ |
| 0          | 48 css px/s | 2.08 s      | 16 s / 24 s                    |
| 8          | 84 css px/s | 1.19 s      | 9.1 s / 13.7 s                 |

`MIN_GRAB_WINDOW_MS` (1.1 s) is asserted for every step of the ladder in
`belt.test.ts`. The old 18 s→9 s traverse ran the top of the ladder at 114–128
css px/s on an iPad — a 0.78–0.88 s window, under the reach time of a
four-year-old who has to aim at a target that will have moved.

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

| Dial                | Easiest        | Hardest | Driven by     |
| ------------------- | -------------- | ------- | ------------- |
| Dish speed          | 48 css px/s    | 84      | belt skill    |
| `MAX_WAIT_MS`       | 4 s            | 9 s     | belt skill    |
| Wanted-dish density | ~1 in 3 dishes | ~1 in 6 | belt skill    |
| Dish pitch          | roomy          | tight   | fixed for now |

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
| `conveyorMode.ts` _(new)_ | Phaser widget: belt sprites, dish motion, the lift rules. Owns its display objects, reads scene state through `this.scene`.                                                                                                      |
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
  KEEPS advancing while a dish is held and its plate rides on empty; a dish let go
  without being fed lands back on a plate; feeding leaves the plate riding empty
  and the plate count unchanged; the wanted dish arrives inside the budget.
- **Device** — iPad and iPhone-landscape: is the belt legible, is the grab
  comfortable, does the wait feel like anticipation or like dead air.

## Answered as built

1. **Direction** — left → right, dishes emerging from a hatch at the left edge.
   Still worth trying the mirror with a Ukrainian-speaking child on the device.
2. **Own difficulty meter** — yes, `belt`, persisted beside `cognitive`. It moves
   on a belt-specific signal: MISSED PASSES (wanted dishes that rode the whole
   visible span un-taken), never on wrong feeds, which are cognitive.
3. **Whole round**, injected like a duo. Kitchen kinds are excluded from belt
   rounds (`CONVEYOR_EXCLUDED_KINDS`) — a pot is filled from the tray, and the
   belt is what replaced the tray.
4. **Round mode, not an episode.** Cheaper, and it keeps the belt appearing
   across all four existing themes (it tints per episode for free).
5. **Gaps, yes** — an eaten dish leaves its lane empty until the lane comes round
   past the hatch, which is what makes the wait readable.
6. **Never a big bite.** The belt IS the treat; eight glowing plates behind a
   moving belt would just be noise.

### What building it changed

- `BELT_HIDDEN_LANES` is **one**, and that is a correctness constraint rather
  than a visual one: a rescue dish still has to RIDE from the hatch into reach, so
  every hidden lane adds a full pitch of latency to the anti-drought promise. At
  the easiest setting a pitch is ~3 s against a 4 s budget.
- The anti-drought guarantee is polled **every frame**, not once per lane-wrap.
  Checking it only at the hatch left a whole pitch of latency on top of the ride
  out; the per-frame check re-dresses the lane currently behind the hatch, which
  is invisible by definition and always exists.
- The honest ceiling is therefore `max(maxWaitMs, hatchDelay) + one pitch`, and a
  slow belt compensates for its slow delivery by running wanted dishes DENSE (one
  in three at the easiest setting) so the wait the child actually meets stays a
  fraction of it. Both are asserted in `belt.test.ts`.
- Belt art is **procedural for now** (`ftm-belt`, `ftm-belt-roller`, `ftm-hatch`
  in `textures.ts`), neutral grey and tinted by `episode.palette.table`. Dropping
  `art/belt-strip.png` etc. in later takes over through the same `hasArt()`
  contract every other look uses — no code change.

### What the first play session changed

- **The freeze is gone.** The belt now runs from `serve` to `stop`, and grabbing
  lifts the dish off its plate instead of stopping the world (see "Lift rules").
  The freeze never protected the _grab_ anyway — touch-down was always on a moving
  dish — only the drag, and lifting protects that for free.
- **A plate outlives its dish.** `Lane.foodId` going null now means "empty plate,
  still riding" rather than "nothing here": the plate is drawn, positioned and
  refilled on its own schedule. Eating, lifting and the thief all leave one.
- **A lifted dish CLAIMS its plate** (`Lane.claim`). Nothing may be put on a
  claimed plate — not the hatch refill, not the dry-belt rescue — so "the dish in
  your hand always has somewhere to go back to" is structural rather than a
  fallback chain that can run out. The rescue may therefore have to skip a pitch;
  that is the right trade, because the child holding a dish is not the one waiting.
- **`Tray.arcTo` takes a live target** and registers its flight, because "home" is
  now a moving plate. Two latent bugs fell out of that: an arc animated the food
  from a tween on a helper object, so `tweens.isTweening(food)` was blind to it and
  `removeFood` could not cancel it (it went on writing x/y to a destroyed sprite).
- **The speed dial became css px/s** — see "Grab fairness". The old traverse dial
  ran the top of the ladder past what a four-year-old can reach for, and did it
  differently on every screen width.
- **A wait may now run its full budget without being a defect.** Ros: "running out
  of matching food on screen and having to wait a bit is a normal case." The
  anti-drought guarantee stays as the ceiling; nothing was added to shorten waits,
  and the `belt.test.ts` simulation counts a dry belt only while the child's hands
  are empty (holding the wanted dish is not a drought).

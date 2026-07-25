# Design — Kitchen: build a dish

> Status: **SHIPPED — phase 1** (`recipes.ts`, `kitchenMode.ts`). Every open
> question below is answered at the end; the dish sheet is still phase 2.
> Adds: sequencing, part–whole composition ("this thing is made of those things").

## The pitch

The friend does not ask for an apple — it asks for a **sandwich**. A cooking pot
(or board) stands on the table. The child drags in the ingredients the recipe
shows; each one lands in the pot with a puff of steam; when the last one is in,
the finished dish pops out, and _that_ is what gets fed to the friend.

Two feeds in one round, and the second one is something the child made.

## Why this one

Every request the game can make today points at objects that already exist on
the tray. A recipe points at an object that **does not exist yet** and has to be
assembled — the first time the game asks the child to hold a goal that is
composed of sub-goals. That is the seed of sequencing, and it is the single
biggest conceptual step available in this game.

It is also the cheapest big feature in art terms after the first slice, because
several composed dishes are _already in the food catalog_ (see Art).

**Gameplay impact:** rounds get longer and more deliberate, which is a welcome
change of rhythm next to the quick match-and-feed loop; the risk is that a
4-year-old reads the recipe as "feed these three things to the friend" and skips
the pot entirely. The pot has to be visually louder than the friend's mouth
during a kitchen round, and the friend should refuse raw ingredients with the
familiar spit-back rather than accepting them.

## Research notes

- **Open-ended beats step-locked at this age.** Toca Kitchen deliberately has no
  levels and no scores — 12 ingredients, ~180 preparations, and the only feedback
  is the character's reaction to what you made
  ([Educational App Store](https://www.educationalappstore.com/app/toca-kitchen),
  [Toca Boca](https://www.tocaboca.com/kids/toca-boca-jr)). Toca Boca's stated
  first principle is "kids first" — everything judged from the child's point of
  view, with room for the quirky and imperfect
  ([Motionographer](https://motionographer.com/2016/04/27/the-design-process-behind-toca-bocas-infectious-apps/)).
  → Our version has a _target_ dish (we are a learning game, not a sandbox), but
  the failure mode must stay Toca-shaped: a wrong ingredient is a funny reaction,
  never a red X.
- **Three to four steps is the established recipe length** in kids' cooking
  games (Sara's Cooking Class runs 3–4 steps per dish across 200+ ingredients;
  Dr. Panda's cookbook is a chain of small minigames)
  ([Sara's Cooking Class](https://www.gamesgames.com/games/saras-cooking-class-games),
  [Dr. Panda Restaurant](https://www.drpanda.com/games/DrPandaRestaurant/index.html)).
  Those target 6+, so for 3–4 we start at **2 ingredients** and grow to 4.
- **Drag-and-drop is expensive for 4–6-year-olds** — significantly slower than
  tapping, with the accuracy loss concentrated on final approach
  ([Yadav et al. 2021](https://onlinelibrary.wiley.com/doi/abs/10.1002/hbe2.305),
  [FittsFarm](https://dl.acm.org/doi/10.1007/978-3-030-29387-1_38)).
  → A recipe of 4 ingredients means 5 drags in one round. The pot needs a snap
  radius at least as generous as the mouth's, and 4-ingredient recipes should sit
  at the very top of the difficulty range.
- **Food games for kids lean on sorting, matching and recognition** as the core
  verbs ([keiki roundup](https://keiki.app/blog/food-games-for-kids),
  [EduKitchen](https://apps.apple.com/app/id587107345)); composition is the rarer,
  more advanced verb — which is exactly why it is worth adding here.

## The mechanic

### The round

1. The bubble shows the **finished dish, large**, with its ingredients in a row
   underneath.
2. A **pot** stands on the table between the friend and the tray.
3. Dragging a correct ingredient into the pot: it drops in, steam puffs, the
   matching picture in the bubble ghosts out — the exact ghosting language the
   game already uses for counts (`grayedBubbleItems`).
4. A wrong ingredient: the pot **spits it back**, same arc-home motion and
   "blegh" beat as the friend's spit-back. Consistency matters more than novelty
   here — the child already knows what that means.
5. Last ingredient in: a little cook animation (lid rattle, steam burst, a
   chime), and the finished dish **pops out of the pot** and sits on top of it,
   draggable.
6. Drag the dish to the friend → normal eat, normal round completion.

The friend refuses raw ingredients during a kitchen round (spit-back), so there
is exactly one right thing to do at every moment.

### Recipe representation (no text, no symbols)

No `+` and no `=` — both are abstract for a non-reader. The bubble reads
top-to-bottom instead:

```
        ┌─────────┐
        │   🥪    │   ← the finished dish, big
        └─────────┘
         🍞 🧀 🍅      ← its parts, in a row, ghosting as each goes in
```

The vertical "big thing above, its parts below" arrangement is the same
whole/parts relationship the picture itself expresses, so it needs no learning.

### Order

Two sub-kinds, unlocked separately:

- **`dish`** — any order accepted. This is the entry version.
- **`dish-ordered`** — the parts must go in left-to-right; an out-of-order
  ingredient is spat back and the next-needed slot pulses. This is the actual
  sequencing trainer, and it should only appear well up the meter.

### No-fail rules

- Ingredients are never consumed by a mistake; they arc home.
- The tray always contains every ingredient the recipe needs (same guarantee as
  `generateTray` today).
- The finished dish, once made, cannot be lost — dropping it anywhere but the
  mouth arcs it back onto the pot.

## Adaptive difficulty

A kitchen round is a **task kind in the existing registry**, not a separate mode
— it is a cognitive task, so the cognitive meter should own it.

| Dial                  | Range                                        | Driven by                 |
| --------------------- | -------------------------------------------- | ------------------------- |
| Ingredient count      | 2 → 3 → 4                                    | cognitive meter           |
| Order required        | off → on                                     | unlocks high in the meter |
| Distractor similarity | unrelated foods → foods from _other_ recipes | meter                     |
| Dishes in rotation    | 1–2 familiar → the whole set                 | meter                     |

Proposed registry rows (`logic.TASK_REGISTRY`):

```
{ kind: 'dish',         minSkill: 5,  maxSkill: 12, weight: 3 }
{ kind: 'dish-ordered', minSkill: 10, maxSkill: 12, weight: 2 }
```

`minSkill: 5` puts it after `combo` (two things at once) and around `not` — the
child is comfortable with multi-item requests before being asked to compose one.

## Integration

| File                     | Change                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recipes.ts` _(new)_     | Pure registry: `{ id, resultFoodId, ingredients: string[], episodes?: string[] }`. Adding a dish = one row + one sprite. Unit-tested: every ingredient exists in the catalog, every result exists, every recipe is satisfiable from every episode pool it is offered in. |
| `logic.ts`               | `DishRequest` type, generation, `wantsFood` / `isRoundComplete` / `bubbleItems` / `grayedBubbleItems` branches, tray composition guarantee.                                                                                                                              |
| `kitchenMode.ts` _(new)_ | Phaser widget: the pot, its snap zone, the drop/steam/cook/pop animations, the made-dish sprite. Same self-contained shape as `duoMode.ts`.                                                                                                                              |
| `requestBubble.ts`       | The dish-above-parts layout.                                                                                                                                                                                                                                             |
| `layout.ts`              | `potPos(m)` + `potSnapRadius(m)`, proportional, unit-tested. Must not collide with the friend at `FULL_SCALE` on a 4:3 iPad.                                                                                                                                             |
| `testHook.ts`            | `pot: { xCss, yCss, contents: string[] } \| null`, `madeDish: string \| null`.                                                                                                                                                                                           |
| `FeedDevPanel.tsx`       | `dish` / `dish-ordered` chips (the chip row already exists).                                                                                                                                                                                                             |

## Art

### Reuse as-is (no new files)

- **All 49 food sprites** serve as ingredients.
- **Four dishes in the catalog are already composed foods** and can be recipe
  _results_ with zero new art:

  | Result (exists)   | Plausible recipe from existing ingredients |
  | ----------------- | ------------------------------------------ |
  | `food-burger` 🍔  | bread + cheese + tomato                    |
  | `food-hotdog` 🌭  | bread + bacon                              |
  | `food-waffle` 🧇  | egg + butter _(+ honey at 3 parts)_        |
  | `food-custard` 🍮 | egg + honey                                |

  → **The first slice of this feature can ship with only the pot as new art.**
  That is the recommended way to build it: prove the mechanic on four recipes,
  then generate the dish sheet.

- **`ftm-halo`, `puffs`, `stars`, `confetti`** (procedural) — steam, cook burst
  and the pop are all covered by existing emitters.

### New art needed

**Phase 1 — required (1 sprite):**

| #   | Name  | What it is                                                                                                                                                                                         |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pot` | A friendly wide cooking pot, 3/4 view, two handles, no lid (contents must be visible), thick soft outline matching the food sprites' style. Neutral metal/enamel so `episode.palette` can tint it. |

Optional companion: `pot-lid` (a lid that hops during the cook beat) — decide at
build time; a scale/rotate tween on the pot may be enough.

**Phase 2 — the dish sheet (~10 sprites):** new composed results, same style as
the existing food PNGs (thick outline, flat cartoon shading, transparent, square-
ish footprint).

| #   | Name             | Recipe (all ingredients already exist)                   |
| --- | ---------------- | -------------------------------------------------------- |
| 1   | `food-sandwich`  | bread + cheese + lettuce                                 |
| 2   | `food-soup`      | bowl of soup — carrot + corn + tomato                    |
| 3   | `food-salad`     | bowl — lettuce + cucumber + tomato                       |
| 4   | `food-pizza`     | slice — bread + cheese + tomato _(vs burger — pick one)_ |
| 5   | `food-smoothie`  | glass — banana + strawberry + blueberries                |
| 6   | `food-pancakes`  | stack — egg + butter + honey                             |
| 7   | `food-fruit-cup` | cup — apple + grapes + kiwi                              |
| 8   | `food-ice-cream` | cone — melon + cherries _(or milk-ish)_                  |
| 9   | `food-juice`     | glass with straw — orange + lemon                        |
| 10  | `food-porridge`  | bowl — corn + honey + blueberries                        |

These drop straight into `art/` and the existing glob picks them up; they also
immediately become usable as ordinary foods in later episodes, which is a nice
side benefit.

## Test plan

- **Unit (`recipes.test.ts`)** — every recipe's ingredients and result exist in
  `ALL_FOODS`; every recipe offered in an episode is satisfiable from that
  episode's pool; no recipe's ingredient list contains its own result.
- **Unit (`logic.test.ts`)** — dish rounds generate satisfiable trays across
  seeds; `wantsFood` accepts only the next-needed ingredient in ordered mode and
  any missing one in free mode; completion requires the _made dish_, not the
  parts.
- **Unit (`layout.test.ts`)** — the pot never overlaps the friend at
  `FULL_SCALE`, nor the tray, at 4:3 and ~2.2:1.
- **E2E** — build a 2-ingredient dish end to end with real pointer drags; a wrong
  ingredient is spat back and the tray stays whole; the friend refuses a raw
  ingredient; the made dish completes the round.

## Answered as built

1. **Pot** — more fun to animate, and the lid-rattle + steam burst is what sells
   "it cooked" without any new art.
2. **The child feeds it.** Feeding is the game's core verb; the made dish pops out
   of the pot, bobs to say "take me", and arcs back onto the pot if dropped
   anywhere else.
3. **Only in kitchen rounds.** A permanent pot would take that ground every round
   for nothing.
4. **Phase 1 as recommended**, six recipes over four results that already exist in
   the catalog — so the only new art is the pot. Every ingredient tier (2 / 3 / 4
   parts) has more than one recipe, so a round is never predictable.
5. **A task kind inside existing episodes**, owned by the cognitive meter. A
   recipe's parts are pushed onto the tray by id whatever the episode, and
   `buildSceneTextures` now covers every food a recipe can name.
6. **The pot spits it back**, with the same arc-home motion and "blegh" beat as
   the friend's spit-back. Consistency beats novelty: the child already knows what
   that means. It also counts as a cognitive slip, because it is the same mistake.

### What building it changed

- The pot's vertical anchor is a share of the **hero→tray band**, not of the
  height. A share of the height read fine on a 4:3 iPad and put the pot straight
  through the plate row on a short phone-landscape viewport (caught by the new
  `layout.test.ts` device sweep), so there is also a hard floor keeping its foot
  clear of a plate.
- The bubble grows to two rows for a kitchen round, and the panel now nudges its
  own centre down when it is taller than standard — at the shared centre the
  upper row hung off the top edge.
- A kitchen round's parts ghost from `kitchenMode`, not from `eaten`: the parts are
  cooked, never eaten, which is the same reason dots drives its pips directly.

# Design — The thief

> Status: **SHIPPED, both phases** (`thief.ts`, `thiefMode.ts`). Every open
> question below is answered at the end.
> Adds: sustained attention while a main task is running; later, go/no-go
> response inhibition.

## The pitch

Every now and then a cheeky bird glides in, lands on one of the plates and
starts pecking at the food. A tap sends it flapping off empty-clawed. Ignore it
long enough and it flies away _with_ the food — at which point a fresh one drops
onto the plate, because nothing in this game is ever lost.

Later, a second visitor arrives: a butterfly, which must be left alone.

## Why this one

Everything the child does today is one task at a time, entirely self-paced. The
thief is the game's first **interruption** — something that demands a response
while the real job (feed the friend) is still open. That is a different muscle
from anything in `TASK_REGISTRY`, and it is the natural precursor to the go/no-go
version below, which is the cleanest, best-evidenced executive-function exercise
available for this age.

It is also, frankly, the cheapest delight per line of code of the three
features, and the one most likely to make a four-year-old shriek.

**Gameplay impact:** big variety and tension spike for very little structural
change; the risk is that it hijacks attention from the actual learning task and
turns a thinking game into a reflex game. Mitigations: it is rare, it is
telegraphed, it never blocks the round, and its frequency is capped by the same
"don't pile on a struggling child" gate the duo uses.

## Research notes

- **Go/no-go works at 3–4 when it is dressed as a concrete fantasy.** A validated
  child protocol for exactly this age frames it as fishing: press for the fish,
  withhold for the shark
  ([dance-mat go/no-go, Front. Psychol.](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6805719/)).
  → "Tap the thief, don't tap the butterfly" is the same paradigm in our world.
  Phase 2 of this design is therefore not decoration, it is the point.
- **Inhibitory control is trainable in preschool and game training moves it**
  ([Nature Sci. Rep. 2015](https://www.nature.com/articles/srep14200),
  [systematic review 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10887659/),
  [group-games RCT](https://www.tandfonline.com/doi/full/10.1080/10409289.2020.1802972)).
- **Divided attention is exactly "monitor the whole scene while doing the main
  thing"** — the mechanic that loads attentional control across game genres
  ([Bavelier & Green, Neuron 2019](https://www.sciencedirect.com/science/article/pii/S0896627319308335)).
- **Careful with rewards and penalties.** HCI work on children's games found that
  reward/penalty framing can pull children _away_ from the intended thinking
  behaviour ([ACM TOCHI 2021](https://dl.acm.org/doi/10.1145/3485168)).
  → Catching the thief must NOT pay growth or stars. It pays joy: confetti, a
  squawk, a delighted friend. The journey stays tied to care performed.
- **Toca Boca / Sago Mini house style**: non-violent, no death, quirky, and
  understandable in seconds
  ([Game Informer](https://gameinformer.com/b/features/archive/2016/10/28/how-to-introduce-your-toddler-to-gaming.aspx),
  [Sago Mini](https://en.wikipedia.org/wiki/Sago_Mini)).
  → The thief is never scary and never punished; it is shooed, it squawks, it
  comes back another day. No cages, no bonks.

## The mechanic

### The beat

```
 telegraph 1.0–1.5 s     glide 1.24 s    peck window        exit
 a distant caw       →   bird flies   →  1.5–3.0 s      →   flies off
 (nothing drawn)         to a plate      (tap → shoo)        (with or without)
                         └──────── tappable ─────┘
```

- **Telegraph is mandatory.** Two descending caws off stage, well before the bird
  is on screen. Nothing may ever appear on a plate without warning — at this age an
  unannounced grab reads as unfair, not exciting. It is a SOUND and nothing else:
  the telegraph shipped as a shadow sliding across the table to the plate, and a
  shadow with no bird over it is a lie the eye catches (it also teleported back out
  to the right edge the instant the real bird entered and took the shadow over). A
  bird still off screen and high casts nothing the child can see.
- **The glide is half the catch window.** The visitor is tappable from its first
  frame on screen, and it flies slowly enough (`thief.APPROACH_MS`) for a
  four-year-old to land a finger on it in mid-air. Shortening it would buy
  difficulty by making the visit less catchable rather than more demanding, so it
  is the same length at every skill.
- **Target choice**: a plate that currently holds a food. Prefer a **distractor**
  over a food the request wants (see no-fail).
- **Tap to shoo**: a generous hit area (`layout.visitorTapRadius` — a ~2.7 cm
  circle, roomier than a food's, because it is the only target that moves), a
  squawk, a puff of feathers, the bird arcs off screen. The friend does a
  `beHappy` giggle.
- **Success (from the bird's side)**: it lifts the food and flies off with it in
  its beak; the plate is briefly empty and a replacement food drops in with the
  existing bounce. **The round stays completable at all times.**

### No-fail rules

1. The thief prefers a **distractor**. It only ever targets a wanted food if the
   tray holds nothing else — and in that case the replacement dropped in is
   guaranteed to be the same food. "Wanted" means anything the round still NEEDS,
   which is not the same question as "would the friend eat it now": on a kitchen
   round the need lives in the pot, and asking `wantsFood` alone made every raw
   ingredient look like a distractor. The bird carried off the honey a recipe
   called for and the round could never be finished — a hard lock, reported from
   the iPad. `FeedTheMonsterScene.wantsNow` now asks the pot too
   (`logic.potRemaining` — every outstanding part, not just the next acceptable
   one), and it only ever targets food that sits on a real plate (the cooked dish
   on the pot reports slot −1 and has nowhere to be replaced to).
2. Never during a spit-back reaction, a growth pop, a celebration, a transition,
   or a duo. Never while a food is being dragged. Never on a **kitchen round**
   either: cook-this-then-feed-that is already a compound goal, and an
   interruption on top of it is the one combination that reads as unfair. (That
   clause was in the code's comment from the start but never in its expression.)
3. Never twice in the same round.
4. Stolen food is replaced, always. The child cannot reach a state where the
   request cannot be cleared.

### Phase 2 — the go/no-go visitor

Once the thief is understood, a **butterfly** starts appearing on the same
approach path. It lands, flutters for the same window, and leaves on its own,
having taken nothing. Tapping it is not punished — it simply flies away and the
friend does _not_ giggle (the reward is withheld, nothing is deducted).

That is a clean go/no-go: respond to one class, withhold for the other, with the
"no-go" trials mixed in at a low rate (~30%, the standard ratio that makes
withholding hard). It only unlocks once the child reliably catches thieves.

## Adaptive difficulty

The thief rides its **own axis**, like the duo — driven by live data plus chance,
never by the cognitive meter, and gated so it never lands on a struggling child.

| Dial                        | Easiest             | Hardest         |
| --------------------------- | ------------------- | --------------- |
| Glide (tappable flight)     | 1.24 s — never less | 1.24 s          |
| Peck window (time to react) | 3.0 s               | 1.5 s           |
| Telegraph lead              | 1.5 s               | 1.0 s           |
| Frequency                   | ~1 in 4 rounds      | ~1 in 2 rounds  |
| No-go visitor rate          | 0 %                 | ~30 % of visits |

The whole tappable window (glide + peck) therefore runs 4.24 s → 2.74 s, floored by
`thief.MIN_TAPPABLE_MS` so the hardest visit still measures attention rather than
reflexes.

Its own small persisted meter (`thief`), moved by whether the last few visits
were caught in time. Gates, mirroring `shouldInjectDuo`:

- cognitive skill ≥ 3 (the child is fluent with the basic loop),
- not currently struggling (`lastRoundEased === false`),
- never in a duo, belt, kitchen or commission round, never mid-transition,
- never two rounds in a row.

## Integration

| File                     | Change                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thief.ts` _(new)_       | Pure: should-a-visit-happen decision, which plate, thief-vs-butterfly draw, window/lead curves, meter update. Seedable, unit-tested.                                                    |
| `thiefMode.ts` _(new)_   | Phaser widget: shadow, approach path, perch, peck loop, shoo/steal outcomes, feather puff. Self-contained like `duoMode.ts`. Reads `scene.tray.foods` / `scene.round` to pick a target. |
| `tray.ts`                | `dropReplacement(slotIndex, foodId)` — reuses the existing drop-in bounce; and a guard so a stolen food is removed cleanly if it was mid-tween.                                         |
| `FeedTheMonsterScene.ts` | Schedule a visit at round start (a `time.delayedCall`); cancel it on `completeRound` / transition / duo.                                                                                |
| `shared/progress.ts`     | Nothing new — a second skill key already fits the existing two-axis store.                                                                                                              |
| `testHook.ts`            | `visitor: { kind: 'thief' \| 'butterfly', slot, phase, msLeft } \| null`; `forceThief()` dev/e2e hook.                                                                                  |
| `FeedDevPanel.tsx`       | "🐦 Thief" / "🦋 Butterfly" buttons.                                                                                                                                                    |

## Art

### Reuse as-is (no new files)

- **Everything already on stage** — friends, foods, plates, backgrounds.
- **`puffs`, `confetti`, `stars`** (procedural emitters) — the feather burst and
  the catch celebration.
- **The friend's existing reactions** — `beHappy`, `squintEyes`, `shakeHead`
  cover the friend's whole emotional response to the thief. No new rig work.
- **Shadow** — the game already draws elliptical shadows procedurally; the bird's
  own is one more. It exists only while the bird does (see the telegraph, above).

### New art needed

Follows the proven whack-a-mole critter approach: **separate full-body frames,
swapped** — no face-anchored parts, no rigged wings. That is what the whack
critters do, and it is the pattern that has not caused layout bugs.

**Phase 1 — the thief (3 sprites):**

| #   | Name             | What it is                                                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `thief-fly-up`   | Cheeky bird (seagull / magpie / crow — see open questions), side-on, wings **raised**, body level, gliding |
| 2   | `thief-fly-down` | Same bird, same size and anchor, wings **lowered** — alternating the two gives flight                      |
| 3   | `thief-perch`    | Same bird standing, head down and beak forward mid-peck, wings folded                                      |

Same style as the friend sprites: thick soft outline, flat cartoon shading,
transparent background, big friendly eye, mischievous not menacing. All three
must share one body anchor so swapping frames does not make the bird jump.

Optional 4th: `thief-carry` — the perched pose with an open beak, so a stolen
food can be drawn in it (the food sprite is drawn on top at runtime, so this may
not be needed; decide at build).

**Phase 2 — the no-go visitor (2 sprites):**

| #   | Name               | What it is                            |
| --- | ------------------ | ------------------------------------- |
| 4   | `butterfly-open`   | Butterfly, wings spread, top-down-ish |
| 5   | `butterfly-closed` | Same butterfly, wings together        |

It must read as _obviously harmless_ next to the bird — bright, round, soft, no
beak — because the whole no-go trial depends on the child telling them apart at a
glance.

**Total: 3 sprites for phase 1, 2 more for phase 2.**

## Test plan

- **Unit (`thief.test.ts`)** — the gates hold (never while struggling, never
  back-to-back, never below the skill floor); target selection prefers
  distractors and only picks a wanted food when nothing else is available;
  window/lead curves monotone; the no-go rate lands near target over many seeds.
- **E2E** — force a visit; tapping in the window shoos it and the tray stays
  whole; letting the window lapse steals the food _and_ a replacement arrives;
  the round is still completable after a theft; no visit occurs during a duo or a
  celebration.
- **Device** — is the telegraph enough warning; is the tap target big enough for
  a four-year-old's finger on a moving bird; is it funny rather than stressful.

## Answered as built

1. **Magpie** — flies, reads as a thief everywhere, at home in all four themes.
2. **One bird for every episode.** Per-episode visitors are ×4 the art for a beat
   that lasts three seconds.
3. **Joy only.** Confetti, a squawk and a delighted friend; no growth, no stars.
   The journey stays tied to care performed.
4. **Both phases shipped together.** The butterfly is gated behind the thief's OWN
   meter (`BUTTERFLY_MIN_SKILL`), so it cannot reach a child who is not yet
   reliably catching thieves — which is what "land the thief first" was protecting
   against, enforced by the adaptive axis instead of by a release order.
5. **Not yet.** Worth adding once the plate version has been watched on a device.
6. **Every tap on a visible visitor counts**, including one during the glide in.
   Punishing an eager child for being early is the wrong lesson, and there is
   nothing to tap during the telegraph — so spam-tapping the sky can never pay off.

### What building it changed

- Tapping the butterfly **holds** the thief meter rather than dropping it. The
  reward was already withheld (no giggle); deducting on top of that would punish
  the same slip twice.
- The stolen food's replacement is scheduled OFF the visit's own timer list. It was
  on it, and `finish()` cleared that list on the very next line — so the bird flew
  off with the food and nothing ever came back. Only a cancelled round (the round
  is over, there is no plate to refill) calls the replacement off now.
- Visitors are gated off belt rounds, kitchen rounds and commissions as well as
  duos: a bird on a moving belt is two new mechanics in one round, and a bird over
  a pot interrupts a goal the child is still holding in their head.
- Both visitors are drawn **procedurally for now** — three magpie frames sharing
  one body anchor plus two butterfly frames, following the whack-critter
  separate-full-body-frames pattern rather than anything face-anchored.

### After watching it played on the iPad

- **The glide was twice too fast** (620 ms). The bird was on the plate before the
  child had finished turning their head, so "you may tap it in the air" was true in
  code and false in practice: every catch was made on the perch. It is now 1.24 s
  (`thief.APPROACH_MS`), a pure design dial in the pure module and unit-tested. The
  telegraph was left alone at 1.0–1.5 s — it already reads, and stretching it would
  only add waiting, not another chance to act.
- **The hit area is a circle, not the sprite rectangle** (`layout.visitorTapRadius`):
  proportional to a tray slot, floored at ~1.3 cm of radius, and re-derived on every
  frame swap. Phaser's `setInteractive` silently ignores a new shape once an object
  is interactive, so the shape is assigned in place — a lesson worth keeping.
- **The telegraph shadow was cut.** Two shadow behaviours could not both be right:
  a telegraph tween sliding one to the plate, and `update()` pinning one under the
  bird. What played was a shadow arriving next to the food with nothing above it,
  then jumping back to the right edge when the bird appeared. Only the bird's own
  shadow survives; the warning is the caw.
- **The bird was allowed to steal a recipe ingredient**, because "wanted" was
  asked of the mouth (`wantsFood`) and a kitchen round's need is in the pot. The
  round became uncookable. Fixed at the predicate (`wantsNow` asks
  `potRemaining` too, so the replacement rule inherits it) _and_ at the gate
  (kitchen rounds are `busy`). Two e2e tests take a dozen draws each, because one
  random target proves nothing about a "never".

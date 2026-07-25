# Feature designs

One document per not-yet-built feature. A design lands here **before** any code,
gets argued over, and is edited in place until it is agreed — the file is the
record of what we decided and _why_, so a later session (human or Claude) can
pick it up without re-deriving the reasoning.

Written in English to match the rest of `docs/` and the code comments, even
though the design conversations happen in Ukrainian.

## How we work through one

1. **Design** — this doc: mechanic, adaptive axis, integration, art list, open
   questions.
2. **Discuss** — we settle the open questions together and edit the doc.
3. **Art** — the "Art" section's _new_ list becomes an image-generator prompt
   (`art-atlas-prompt` skill → generate → `art-atlas-slice` skill → PNGs land in
   `src/games/<game>/art/`). Existing sprites are reused wherever possible; the
   list is deliberately as short as it can be.
4. **Build** — implement, unit-test the pure logic, e2e the behaviour, verify on
   the device.
5. Next feature.

## Queue

| #   | Design                                               | Adds which cognitive axis              | Status |
| --- | ---------------------------------------------------- | -------------------------------------- | ------ |
| 1   | [Food conveyor](feed-the-monster-conveyor.md)        | timing, inhibition, sustained scanning | draft  |
| 2   | [Kitchen: build a dish](feed-the-monster-kitchen.md) | sequencing, part–whole composition     | draft  |
| 3   | [The thief](feed-the-monster-thief.md)               | sustained attention, go/no-go          | draft  |
| 4   | [Pixel Studio](drawing-pixel-studio.md)              | fine motor precision + made-by-me art  | draft  |
| 5   | [Drawn food](feed-the-monster-drawn-food.md)         | production instead of selection        | draft  |

## Why these three

Feed the Monster today trains exactly one class of skill: **static attribute
matching plus counting** (colour, count, negation, pattern, mix). Every task kind
in `logic.TASK_REGISTRY` is a variation on "look at the still tray, pick the ones
that match". Nothing in the game has a clock, nothing has to be remembered, and
nothing is built out of parts.

These three features were picked because each opens an axis the game does not
have at all, rather than adding an eighth flavour of "find the red one":

- **Conveyor** puts a clock in the game — scan a moving stream, hold the goal in
  mind, and wait when what you need is not there.
- **Kitchen** makes a target out of _parts_, which is the first step toward
  sequencing and part–whole reasoning.
- **Thief** asks the child to hold the main task while something else demands a
  response — and later, to withhold that response for a friendly visitor.

A fourth candidate (**hide the request**, i.e. the thought bubble closes after a
few seconds and can be peeked at by tapping the friend) is the cheapest working-
memory axis available and is _not_ written up here only because we agreed on
these three first. It stays on the list.

## Why #4 and #5 (a pair)

The drawing game is the one game with **no adaptive axis at all** — nothing to
get better at, nothing measured, and nothing the child makes survives the next
tap on 🗑️. Rebuilding it on a pixel grid gives it a precision ladder (16 → 32 → 64) and, more importantly, turns everything the child paints into a **sprite**
that the other games can use.

**#5 is the reason #4 matters.** The studio on its own is a nicer drawing game;
the studio plus one commission is a loop the app has never had — the game asks
for something, the child makes it, and the thing they made is used in front of
them within seconds. It is also the only feature on this queue that adds a
**productive** task: all eight existing Feed the Monster task kinds ask the child
to _pick_ the answer, and "draw me something red" asks them to produce one.

Build order is therefore fixed: #4 first, but only as far as it takes to make the
pad and the art store real, then #5 immediately — before any of the decorative
reuse slots in #4's tier 1.

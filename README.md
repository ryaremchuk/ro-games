# Ro Games 🎮

**Live:** https://ryaremchuk.github.io/ro-games/

## What this is and why

A picture-only web arcade of small games, built for one particular 3–4 year
old. It runs as a fullscreen PWA on an iPad, hosted free on GitHub Pages — no
ads, no tracking, no in-app purchases, full parental control of every pixel.

The goal is bigger than "keep the kid busy": **every game quietly teaches**
(counting, numerals, categories, colors, memory, fine motor control), and every
game keeps searching for the edge of the child's ability and nudges it forward.
Never boring because it's too easy, never frustrating because it's too hard —
and always kind: there is no "game over", no penalty, no red buzzer anywhere.

The player can't read yet, so everything is visual + audio and touch-first,
with big hit targets. Text exists only as `aria-label`s.

## How the games stay challenging (and kind)

The design rests on three decoupled currencies — skill, levels, and stars:

- **Adaptive skill meters (invisible).** Games measure the child per round —
  wrong taps, targets that got away, time to solve — and move hidden meters up
  on clean quick rounds, down (gently, asymmetrically) when hints were needed.
  Where the skills differ, the axes are separate: Balloon Pop tracks **motor**
  skill (balloon speed, how many float at once) independently from
  **cognitive** skill (number range, distractor tightness, which task types
  rotate in). Great counting on slow fingers gets faster numbers and a slow
  sky — and vice versa. New task types unlock as the meter grows, so variety
  itself is the reward for skill.
- **Progress persists, sessions warm up.** Skill meters are saved to
  `localStorage` after every round (`src/shared/progress.ts`). A new session
  starts a couple of steps _below_ the saved value — plus one more step per
  week away — and climbs back at double speed while below the saved peak. The
  first minute is a friendly refresher, not a cold start at the ceiling and
  not a boring replay of level 1.
- **Levels are a session reward rhythm.** The HUD level badge ticks +1 for
  every solved round — it is a "look how much I played" counter, deliberately
  independent of the skill meters, and it resets each visit. Celebrations
  (the rainbow, sparkles) are pure animations on their own periodic beat.
- **Stars are forever.** Every passed level banks one star — each game
  defines its own level unit (a solved round, a cleared board, ten bops, a
  freed piggy level). Stars accumulate across sessions and never decrease
  (big numbers are a feature): the one number on the launcher tile where the
  child (and the parents) can see long-term progress per game, whatever the
  adaptive meters are doing.
- **No-fail, soft errors.** A wrong tap wobbles and boops, matching items glow
  as an escalating hint, and difficulty eases down before a child can get
  stuck. Struggling changes the game; it never punishes the player.

## The games

| Game                | Teaches                              | Engine    |
| ------------------- | ------------------------------------ | --------- |
| Drawing 🖍️          | free creativity, fine motor          | Canvas 2D |
| Feed the Monster 👾 | counting, colors                     | Phaser    |
| Animal Band 🥁      | sound sequences, memory              | React     |
| Whack-a-Silly 🐹    | reaction, attention                  | Phaser    |
| Odd One Out 🧩      | categories: color→shape→concept      | React     |
| Balloon Pop 🎈      | subitizing, numerals, quantity+color | Phaser    |
| Slingshot Birds 🐦  | aiming, physics intuition            | Phaser    |
| Memory 🐾           | visual memory                        | Phaser    |

---

## Technical

### Quick start

```bash
npm install
npm run dev        # http://localhost:5173/ro-games/
```

### Scripts

| Command                                          | What                                      |
| ------------------------------------------------ | ----------------------------------------- |
| `npm run dev`                                    | Dev server                                |
| `npm run build`                                  | Typecheck + production build + PWA assets |
| `npm run preview`                                | Serve the production build locally        |
| `npm run lint` / `format` / `typecheck` / `test` | Quality gates (also run in CI)            |
| `npm run e2e`                                    | Playwright end-to-end suite               |

### How it's built

React + Vite + TypeScript shell (HashRouter) that launches isolated games from
a single registry (`src/games/registry.tsx` — one entry = tile + route + lazy
chunk). Simple games use Canvas 2D or plain React; richer games use Phaser 4
via a shared mount. Game loops never run through React state. Audio is
synthesized with the Web Audio API — no sound assets. Cross-session state
(skill meters, stars) lives in `src/shared/progress.ts` on top of
`localStorage`. PWA via `vite-plugin-pwa`; deploys to GitHub Pages
automatically on push to `main`.

- Add a game: see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Why the key choices: see [`docs/DECISIONS.md`](docs/DECISIONS.md).
- Guidance for Claude Code: see [`CLAUDE.md`](CLAUDE.md).

### Running it on the iPad

1. Open the live URL in Safari → Share → **Add to Home Screen** (installs the
   PWA fullscreen).
2. Use iOS **Guided Access** (triple-click the side button) to lock the iPad to
   the app so the child can't wander off into Safari.

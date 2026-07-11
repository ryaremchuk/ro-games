---
name: art-atlas-slice
description: Slice an AI-generated sprite-sheet atlas (magenta background, grid of cells) into trimmed transparent PNGs and integrate them into a game. Use when the user returns with a generated atlas image (file path or clipboard) and wants it cut and wired in — e.g. "наріж картинку", "атлас готовий", "вирізай обʼєкти", "slice the atlas".
---

# Art atlas slicer & integrator

Counterpart of `/art-atlas-prompt`. Input: one AI-generated sheet on solid
magenta (#FF00FF) with an invisible equal-cell grid. Output: trimmed
transparent PNGs in the game's `art/` folder, integrated and verified.

## 1. Get the image

- If the user gave a file path — use it.
- If it's in the clipboard (macOS), save it first:

  ```bash
  osascript -e 'set p to the clipboard as «class PNGf»' \
            -e 'set f to open for access POSIX file "/tmp/atlas.png" with write permission' \
            -e 'write p to f' -e 'close access f'
  ```

  (`pngpaste /tmp/atlas.png` if installed.)

- ALWAYS Read the image and look at it BEFORE slicing. Reject and ask the
  user to regenerate if you see: drop shadows on the background, text/labels/
  watermarks, visible grid lines, objects crossing cell boundaries, or a
  non-magenta background. Slicing garbage wastes a whole cycle.

## 2. Find the manifest

`/art-atlas-prompt` writes `.tmp/atlas-manifest.json` in the repo root:
`{ "grid": "4x4", "names": [...], "outDir": "src/games/<game>/art", ... }`.
If it's missing, reconstruct the row-major cell names from the conversation or
ask the user what's in each cell. Names are kebab-case, `-` = empty cell.

## 3. Slice

Run FROM THE REPO ROOT (the script resolves `sharp` from the repo's
node_modules; if absent: `npm i -D sharp`):

```bash
node .claude/skills/art-atlas-slice/slice-atlas.mjs <atlas.png> <outDir> \
  --grid 4x4 --names crab-body,crab-claw,-,sun,...
```

The script chroma-keys magenta to alpha (soft ramp keeps anti-aliased edges),
despills the pink fringe, erodes 1px, trims each cell to its alpha bbox and
writes `<outDir>/<name>.png`. Heed its warnings: "touches the cell edge" and
"marked empty but has content" both mean grid misalignment — usually fixed by
regenerating, occasionally by cropping the source margins first.

## 4. Verify the slices (MANDATORY before integrating)

Read every output PNG and LOOK at it: complete silhouette, no magenta halo,
nothing clipped, style consistent across sprites. A bad single cell can often
be regenerated alone and sliced from a 1x1 "grid".

## 5. Integrate

Follow the whack-a-silly pattern (`src/games/whack-a-silly/WhackASillyScene.ts`):

```ts
const ART_URLS = import.meta.glob('./art/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
// preload(): this.load.image(`<game>-${name}`, ART_URLS[`./art/${name}.png`])
```

- Sprites replace procedural textures at the SAME texture keys where possible,
  so downstream code doesn't change; otherwise update the keys everywhere.
- White/light-gray sprites are for tinting: `img.setTint(color)` — gray
  shading darkens the tint naturally. Never tint colored art.
- Mirrored parts: load once, `setFlipX(true)` for the other side.
- Mind display size: sprites arrive huge (~512px cells) — set displayWidth/
  scale from the css-px design sizes already in the scene, don't trust
  intrinsic pixels.

## 6. Verify in-game, then ship

- Gates: `npm run format:check && npm run lint && npm run typecheck &&
npx vitest run && npm run build`.
- Drive the real game (Playwright, `E2E_PORT=5199`), screenshot, and LOOK:
  sprites crisp on retina (dpr scaling), layering/depths right, tap targets
  still generous, no procedural leftovers poking out.
- Delete any temp specs/screenshots inside the repo before committing.

## License

Public repo: AI-generated or CC0/CC-BY only. Never premium-pack files.

---
name: art-atlas-prompt
description: Compose a copy-paste prompt for an AI image generator (nanobanana/Gemini/ChatGPT/DALL-E) that produces a game sprite-sheet atlas which the art-atlas-slice skill can cut cleanly. Use when the user asks for an image-generation prompt for game art, sprites, or an atlas — e.g. "дай промпт для нанобанана", "промпт для генератора картинок", "image prompt for sprites".
---

# Art atlas prompt composer

Produce ONE copy-paste prompt for an image generator, plus a manifest file so
`/art-atlas-slice` later knows exactly how to cut the result. The two skills
share a contract: solid-magenta background, invisible equal-cell grid, one
object per cell.

## Steps

1. **Collect the object list** from the user's description of what art is
   needed. Apply these rules without asking (ask only if the request is truly
   ambiguous):
   - Rigged characters (parts move independently in-game) → each part is its
     OWN cell (body, claw, eye, …). Body cells must say "WITHOUT eyes/claws"
     when those are separate parts.
   - Mirrored parts (left/right claw, ear, wing) → generate ONE side only;
     the engine flips it.
   - Objects the engine will tint (`setTint`) → the prompt must demand pure
     WHITE to very-light-gray art with subtle shading, and say why ("will be
     color-tinted by the game engine").
   - Counting/teaching surfaces (dots, numerals) stay procedural — never put
     them in an atlas.
2. **Pick the grid**: smallest R×C that fits the objects, max 4×4 per image
   (more cells = less detail per object). If more objects are needed, split
   into several atlases/prompts. Leftover cells are declared EMPTY.
3. **Compose the prompt** in ONE fenced code block containing nothing else:
   - The mandatory slicer-contract header (below), with the chosen grid size.
   - The project style block (below).
   - Numbered cell descriptions, ROW-MAJOR (left→right, top→down), grouped
     into logical rows. Each description: one object, concrete colors, no
     ambiguity.
4. **Write the manifest** to `.tmp/atlas-manifest.json` in the repo root
   (create `.tmp/` if needed) so the slicing session — possibly a different
   conversation — can cut without guessing:

   ```json
   {
     "grid": "4x4",
     "names": ["crab-body", "crab-claw", "-", "sun"],
     "outDir": "src/games/<game>/art",
     "game": "<game-id>",
     "notes": ["balloons are white → engine-tinted", "claw is left side, engine mirrors"]
   }
   ```

   `names` are kebab-case, row-major, `-` for empty cells, and become the
   output PNG filenames.

5. After the code block, add one short line reminding the user: if the result
   has shadows on the background, text/labels, a visible grid, or objects
   touching cell edges — regenerate, don't try to fix it in post.

## Slicer contract (include in EVERY prompt, verbatim apart from grid size)

```
Create ONE sprite-sheet image, square 2048×2048, on a SOLID pure magenta background (#FF00FF).
Arrange exactly N cells in an invisible RxC grid (each cell ~SIZE px). ONE object centered per
cell, filling about 75% of the cell, never touching cell edges. NO text, NO labels, NO watermarks,
NO grid lines, NO drop shadows cast onto the background.
```

## Project style block (ro-games)

```
Style for ALL objects: cute flat cartoon for a toddler app (age 3-4), soft rounded shapes, smooth
clean edges, gentle soft shading, light source from the top-left, cheerful and friendly. Keep the
style perfectly consistent across all cells.
```

Palette anchors when a color is needed: coral `#FF6B6B`, sunshine `#FFD93D`,
mint `#6BCB77`, purple `#9B5DE5`, pink `#FF8FAB`, teal `#4ECDC4`,
ink `#3D3A4B` (pupils/outlines).

## License note

The repo is public: only AI-generated or CC0/CC-BY art. Never premium-pack
files.

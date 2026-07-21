/**
 * Sprite-atlas slicer for AI-generated sheets on a pure-magenta background.
 *
 *   node slice-atlas.mjs <atlas.png> <outDir> --grid 4x4 --names crab,claw,-,sun
 *
 * - --grid  RxC (rows x columns), e.g. 4x4, 3x3, 2x4. Cells must be equal.
 * - --names comma-separated kebab-case names, ROW-MAJOR (left→right, top→down).
 *           One per cell; use "-" for an intentionally empty cell.
 *
 * Per cell: key magenta to alpha by HUE (handles multi-shade backgrounds, not
 * just pure #FF00FF), then de-fringe by COLOR-BLEED — recolor the antialiased
 * boundary ring to the true art color it should carry (see defringeCell). That
 * kills the 1–2px purple halo that despilling only half-removes and eroding
 * can't touch once it's baked into opaque edge pixels. Finally trim to the
 * alpha bounding box (+2px pad), write <outDir>/<name>.png.
 *
 * Run from a repo root that has `sharp` in node_modules (this repo does, via
 * its dev toolchain). If missing: npm i -D sharp.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const sharp = require('sharp')

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const args = process.argv.slice(2)
const positional = []
let grid = '4x4'
let namesArg = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--grid') grid = args[++i]
  else if (args[i] === '--names') namesArg = args[++i]
  else positional.push(args[i])
}
const [atlasPath, outDir] = positional
if (!atlasPath || !outDir || !namesArg) {
  fail('usage: node slice-atlas.mjs <atlas.png> <outDir> --grid RxC --names a,b,-,c')
}
const gridMatch = /^(\d+)x(\d+)$/.exec(grid)
if (!gridMatch) fail(`--grid must look like 4x4, got "${grid}"`)
const rows = Number(gridMatch[1])
const cols = Number(gridMatch[2])
const names = namesArg.split(',').map((n) => n.trim())
if (names.length !== rows * cols) {
  fail(`--names has ${names.length} entries but the ${grid} grid has ${rows * cols} cells`)
}
mkdirSync(outDir, { recursive: true })

const img = sharp(atlasPath).ensureAlpha()
const { width, height } = await img.metadata()
const raw = await img.raw().toBuffer()
const cw = Math.floor(width / cols)
const ch = Math.floor(height / rows)
console.log(`${width}×${height} atlas → ${grid} grid, cell ${cw}×${ch}`)

/**
 * Magenta background → alpha via HUE, not distance to pure #FF00FF. The key is
 * "how much green is missing beneath red+blue" (magenta = high R, high B, low
 * G). This transparently handles sheets whose background drifts across shades
 * — e.g. a light/dark magenta checkerboard, where the pale cells sit far from
 * pure #FF00FF and a fixed-radius distance ramp would leave the whole cell
 * opaque. Every magenta pixel scores high here; art (neutral whites, pink
 * tongues, dark ink) scores low, so the split is clean and the antialiased
 * halo is cut far more aggressively.
 *
 * Contract unchanged: keep truly magenta/purple-hued ART out of atlases (tint
 * such art in-engine instead) — it would key out here too.
 */
function keyAlpha(r, g, b) {
  const minRB = Math.min(r, b)
  if (minRB < 30) return 1 // near-black ink outlines are never background
  const magentaness = (minRB - g) / 255 // ~1 for magenta, ≤~0.11 for real art
  const lo = 0.3 // ≤ this: fully opaque (art)
  const hi = 0.55 // ≥ this: fully transparent (background — every shade)
  return Math.max(0, Math.min(1, (hi - magentaness) / (hi - lo)))
}

/**
 * Edge color-bleed de-fringe. After keying, the outermost 1–2px of a sprite is
 * a blend of art and the magenta background — a purple halo. Despilling only
 * half-removes a strong halo (it deliberately under-corrects to spare pinkish
 * art), and eroding can't help once the magenta is baked into fully-opaque edge
 * pixels. So instead of neutralising or deleting, we RECOLOR that ring to the
 * art color it should have had:
 *
 *   - core = opaque pixels (alpha ≥ SOLID) that are NOT within CORE_ERODE px of
 *     any transparent/partial pixel → trustworthy interior color. Auto-relaxes
 *     the erode radius (2→1→0) if a thin sprite would otherwise have no core.
 *   - every non-core pixel with alpha>0 (the halo, the partial-alpha ring, the
 *     contaminated opaque rim) takes the AVERAGE color of its already-resolved
 *     neighbours, flooding outward from the core; its ALPHA is left untouched.
 *
 * Net: the soft edge now wears clean art color at its own coverage alpha —
 * proper antialiasing, zero magenta — while geometry, thin strokes (glasses
 * frames, a smile line) and genuinely purple/red art (eggplant, grapes) all
 * survive: purple simply bleeds its own purple outward, a visual no-op. A tiny
 * alpha floor drops the faintest ghost skirt. Operates on one cell's RGBA buffer.
 */
function defringeCell(buf, w, h) {
  const SOLID = 200 // alpha ≥ this counts as opaque art when finding the core
  const N = w * h
  const alpha = new Uint8Array(N)
  const solid = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    alpha[i] = buf[i * 4 + 3]
    solid[i] = alpha[i] >= SOLID ? 1 : 0
  }

  // core = solid pixels whose entire (2·erode+1)² window is also solid.
  const buildCore = (erode) => {
    const core = new Uint8Array(N)
    let count = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!solid[i]) continue
        let ok = true
        for (let dy = -erode; dy <= erode && ok; dy++) {
          for (let dx = -erode; dx <= erode; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !solid[ny * w + nx]) {
              ok = false
              break
            }
          }
        }
        if (ok) {
          core[i] = 1
          count++
        }
      }
    }
    return { core, count }
  }

  let erode = 2
  let { core, count } = buildCore(erode)
  while (count < N * 0.002 && erode > 0) {
    erode--
    ;({ core, count } = buildCore(erode))
  }

  // Seed resolved colors from the core, then flood outward.
  const R = new Float32Array(N)
  const G = new Float32Array(N)
  const B = new Float32Array(N)
  const has = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (core[i]) {
      R[i] = buf[i * 4]
      G[i] = buf[i * 4 + 1]
      B[i] = buf[i * 4 + 2]
      has[i] = 1
    }
  }
  let changed = true
  let guard = 0
  while (changed && guard++ < 4096) {
    changed = false
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (has[i] || alpha[i] === 0) continue
        let sr = 0
        let sg = 0
        let sb = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const j = ny * w + nx
            if (has[j]) {
              sr += R[j]
              sg += G[j]
              sb += B[j]
              n++
            }
          }
        }
        if (n > 0) {
          R[i] = sr / n
          G[i] = sg / n
          B[i] = sb / n
          has[i] = 1
          changed = true
        }
      }
    }
  }

  // Compose: bled RGB + original alpha (floored). Core keeps its exact bytes.
  const out = Buffer.from(buf)
  for (let i = 0; i < N; i++) {
    let a = alpha[i]
    if (a < 16) a = 0 // drop the faintest ghost skirt
    out[i * 4 + 3] = a
    if (a === 0) continue
    if (has[i] && !core[i]) {
      out[i * 4] = Math.round(R[i])
      out[i * 4 + 1] = Math.round(G[i])
      out[i * 4 + 2] = Math.round(B[i])
    }
  }
  return out
}

for (let cell = 0; cell < rows * cols; cell++) {
  const name = names[cell]
  const cx = (cell % cols) * cw
  const cy = Math.floor(cell / cols) * ch

  // Extract RGBA with keyed alpha. RGB is kept ORIGINAL here; the edge magenta
  // is fixed by defringeCell's color-bleed below (more robust than despilling,
  // which only half-removes a strong halo and can't undo a baked-in opaque rim).
  const buf = Buffer.alloc(cw * ch * 4)
  let opaque = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((cy + y) * width + (cx + x)) * 4
      const di = (y * cw + x) * 4
      const r = raw[si]
      const g = raw[si + 1]
      const b = raw[si + 2]
      const a = keyAlpha(r, g, b)
      if (a > 0.5) opaque++
      buf[di] = r
      buf[di + 1] = g
      buf[di + 2] = b
      buf[di + 3] = Math.round(a * raw[si + 3])
    }
  }

  if (name === '-' || name === '') {
    if (opaque > cw * ch * 0.005) {
      console.warn(`cell ${cell + 1}: marked empty but has content — check grid alignment!`)
    }
    continue
  }

  // Recolor the magenta boundary halo to true art color (see defringeCell).
  const cleaned = defringeCell(buf, cw, ch)

  // Trim to the alpha bbox (+pad).
  let minX = cw
  let minY = ch
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (cleaned[(y * cw + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    console.warn(`cell ${cell + 1} (${name}): EMPTY — expected art here, check the sheet/grid`)
    continue
  }
  if (minX === 0 || minY === 0 || maxX === cw - 1 || maxY === ch - 1) {
    console.warn(`cell ${cell + 1} (${name}): art touches the cell edge — may be clipped`)
  }
  const pad = 2
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(cw - 1, maxX + pad)
  maxY = Math.min(ch - 1, maxY + pad)

  await sharp(cleaned, { raw: { width: cw, height: ch, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toFile(path.join(outDir, `${name}.png`))
  console.log(`cell ${cell + 1} → ${name}.png (${maxX - minX + 1}×${maxY - minY + 1})`)
}
console.log('done')

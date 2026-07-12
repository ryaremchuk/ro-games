/**
 * Sprite-atlas slicer for AI-generated sheets on a pure-magenta background.
 *
 *   node slice-atlas.mjs <atlas.png> <outDir> --grid 4x4 --names crab,claw,-,sun
 *
 * - --grid  RxC (rows x columns), e.g. 4x4, 3x3, 2x4. Cells must be equal.
 * - --names comma-separated kebab-case names, ROW-MAJOR (left→right, top→down).
 *           One per cell; use "-" for an intentionally empty cell.
 *
 * Per cell: chroma-key #FF00FF to alpha with a soft ramp (anti-aliased edges
 * keep partial alpha), despill the magenta halo on edge pixels (kills the pink
 * fringe on white art while leaving interior colors alone), erode alpha 1px,
 * trim to the alpha bounding box (+2px pad), write <outDir>/<name>.png.
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

/** Magenta-ness → alpha: 0 at pure #FF00FF, 1 once safely off-key. */
function keyAlpha(r, g, b) {
  const d = Math.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) / 441.7
  const lo = 0.08 // ≤ this distance: fully transparent
  const hi = 0.22 // ≥ this distance: fully opaque
  return Math.max(0, Math.min(1, (d - lo) / (hi - lo)))
}

for (let cell = 0; cell < rows * cols; cell++) {
  const name = names[cell]
  const cx = (cell % cols) * cw
  const cy = Math.floor(cell / cols) * ch

  // Extract RGBA with keyed alpha + edge despill.
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
      // De-fringe (despill): a magenta cast raises R and B over G by SIMILAR
      // amounts (pink/purple art raises them unevenly). Weight the removal by
      // how balanced the two excesses are, so a 10-40%-blended halo pixel goes
      // neutral while blush-pink or purple art is barely touched. Keep truly
      // magenta-hued art out of atlases regardless (use engine tinting).
      let dr = r
      let db = b
      if (r > g && b > g) {
        const sLo = Math.min(r - g, b - g)
        const sHi = Math.max(r - g, b - g)
        const w = (sLo / sHi) ** 2
        const cut = Math.round(sLo * w * 0.9)
        dr = r - cut
        db = b - cut
      }
      buf[di] = dr
      buf[di + 1] = g
      buf[di + 2] = db
      buf[di + 3] = Math.round(a * raw[si + 3])
    }
  }

  if (name === '-' || name === '') {
    if (opaque > cw * ch * 0.005) {
      console.warn(`cell ${cell + 1}: marked empty but has content — check grid alignment!`)
    }
    continue
  }

  // Erode alpha 1px to kill the last halo ring.
  const eroded = Buffer.from(buf)
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4 + 3
      if (buf[i] === 0) continue
      const up = y > 0 ? buf[i - cw * 4] : 0
      const dn = y < ch - 1 ? buf[i + cw * 4] : 0
      const lf = x > 0 ? buf[i - 4] : 0
      const rt = x < cw - 1 ? buf[i + 4] : 0
      if (up === 0 || dn === 0 || lf === 0 || rt === 0) {
        eroded[i] = Math.round(buf[i] * 0.4)
      }
    }
  }

  // Trim to the alpha bbox (+pad).
  let minX = cw
  let minY = ch
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (eroded[(y * cw + x) * 4 + 3] > 8) {
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

  await sharp(eroded, { raw: { width: cw, height: ch, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toFile(path.join(outDir, `${name}.png`))
  console.log(`cell ${cell + 1} → ${name}.png (${maxX - minX + 1}×${maxY - minY + 1})`)
}
console.log('done')

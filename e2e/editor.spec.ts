import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Loads the `Window.__slingshot` / `__slingshotEditor` global augmentations.
import type {} from '../src/games/slingshot/testHook'
import type { LevelSpec } from '../src/games/slingshot/logic'

/**
 * Drives the hidden level editor (`#/slingshot?edit`) through its REAL DOM
 * buttons plus real pointer drags on the Phaser canvas; the `__slingshotEditor`
 * hook is only read for assertions (never used to mutate).
 */

const readSnap = (page: Page) => page.evaluate(() => window.__slingshotEditor!.snapshot())
const readSpec = (page: Page): Promise<LevelSpec> =>
  page.evaluate(() => JSON.parse(window.__slingshotEditor!.exportJson()))

const waitForEditor = (page: Page) =>
  page.waitForFunction(() => Boolean(window.__slingshotEditor), undefined, { timeout: 20_000 })

/**
 * Open the editor with a clean localStorage draft. Clears the key from the
 * launcher page first (addInitScript would re-wipe on every reload, which the
 * persistence test must not do), then hash-navigates into the editor.
 */
async function gotoFreshEditor(page: Page) {
  await page.goto('./')
  await page.evaluate(() => localStorage.removeItem('ro-games:slingshot-editor-draft'))
  await page.goto('./#/slingshot?edit')
  await waitForEditor(page)
}

const jsonBox = (page: Page) => page.getByRole('textbox', { name: 'Level JSON' })

/**
 * Normalized field coords → css px. Mirrors the scene mapping (in css space):
 * L = min(w, h), offX = (w − L)/2, offY = h − L, for the 834×1112 viewport.
 */
function toCss(page: Page, nx: number, ny: number) {
  const vp = page.viewportSize()!
  const L = Math.min(vp.width, vp.height)
  return { x: (vp.width - L) / 2 + nx * L, y: vp.height - L + ny * L }
}

test('editor: generate, edit, drag, play-test, export round-trip', async ({ page }) => {
  test.setTimeout(120_000)
  // Fresh draft every run — a persisted one would make level asserts flaky.
  await gotoFreshEditor(page)

  // Panel + fresh draft of level 1.
  const start = await readSnap(page)
  expect(start.mode).toBe('edit')
  expect(start.level).toBe(1)
  expect(start.piggies).toBeGreaterThan(0)
  expect(start.reachable).toBe(true)
  await expect(page.getByLabel('Level editor')).toBeVisible()
  await page.screenshot({ path: 'e2e/__screenshots__/editor-open.png' })

  // Export JSON matches the draft counts.
  const spec = await readSpec(page)
  expect(spec.level).toBe(1)
  expect(spec.blocks.length).toBe(start.blocks)
  expect(spec.piggies.length).toBe(start.piggies)

  // Level stepper regenerates: + twice → level 3, different structure.
  await page.getByRole('button', { name: 'Next level' }).click()
  await page.getByRole('button', { name: 'Next level' }).click()
  await expect.poll(async () => (await readSnap(page)).level).toBe(3)
  const level3 = await readSpec(page)
  expect(JSON.stringify(level3.blocks)).not.toBe(JSON.stringify(spec.blocks))

  // Add a wood block via the real button.
  const blocksBefore = (await readSnap(page)).blocks
  await page.getByRole('button', { name: 'Add wood block' }).click()
  await expect.poll(async () => (await readSnap(page)).blocks).toBe(blocksBefore + 1)
  const added = (await readSpec(page)).blocks.at(-1)!

  // Drag the new block with a real pointer: select (tap) then drag left-up.
  const from = toCss(page, added.x, added.y)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x - (80 * i) / 8, from.y - (60 * i) / 8)
  }
  await page.mouse.up()
  await expect
    .poll(async () => {
      const moved = (await readSpec(page)).blocks.at(-1)!
      return Math.abs(moved.x - added.x)
    })
    .toBeGreaterThan(0.04) // 80 css px ≈ 0.096 field units; clamped drops still move
  const snapAfterDrag = await readSnap(page)
  expect(snapAfterDrag.selection).toBe('block')

  // Delete the selected block via the real button.
  await page.getByRole('button', { name: 'Delete selected' }).click()
  await expect.poll(async () => (await readSnap(page)).blocks).toBe(blocksBefore)

  // Play-test: physics arms and the sling accepts aim; then back to edit.
  await page.getByRole('button', { name: 'Play test' }).click()
  await page.waitForFunction(() => window.__slingshot?.state().canAim === true, undefined, {
    timeout: 20_000,
  })
  expect((await readSnap(page)).mode).toBe('play')
  await page.getByRole('button', { name: 'Edit mode' }).click()
  await expect.poll(async () => (await readSnap(page)).mode).toBe('edit')
  await expect.poll(async () => (await readSnap(page)).level).toBe(3) // draft survived the round-trip

  // JSON import via the real textarea: set piggy count to 1.
  const draft = await readSpec(page)
  const edited = { ...draft, piggies: [{ x: 0.7, y: 0.6 }] }
  await jsonBox(page).fill(JSON.stringify(edited))
  await page.getByRole('button', { name: 'Apply JSON' }).click()
  await expect.poll(async () => (await readSnap(page)).piggies).toBe(1)

  // Invalid JSON surfaces an error and leaves the draft untouched.
  await jsonBox(page).fill('{"level": "nope"}')
  await page.getByRole('button', { name: 'Apply JSON' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await readSnap(page)).piggies).toBe(1)
  await page.screenshot({ path: 'e2e/__screenshots__/editor-final.png' })
})

test('editor: draft persists across a reload', async ({ page }) => {
  await gotoFreshEditor(page)
  await page.getByRole('button', { name: 'Next level' }).click()
  await page.getByRole('button', { name: 'Add piggy' }).click()
  const before = await readSnap(page)

  await page.reload()
  await waitForEditor(page)
  const after = await readSnap(page)
  expect(after.level).toBe(before.level)
  expect(after.piggies).toBe(before.piggies)
})

test('editor is absent from the normal child route', async ({ page }) => {
  await page.goto('./#/slingshot')
  await page.waitForFunction(() => window.__slingshot?.state().canAim === true, undefined, {
    timeout: 20_000,
  })
  await expect(page.getByLabel('Level editor')).toHaveCount(0)
  const hasEditor = await page.evaluate(() => Boolean(window.__slingshotEditor))
  expect(hasEditor).toBe(false)
})

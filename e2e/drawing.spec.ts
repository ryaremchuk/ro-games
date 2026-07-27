import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__pixelPad }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { PixelPadState } from '../src/shared/pixel/testHook'

const readState = (page: Page): Promise<PixelPadState> =>
  page.evaluate(() => window.__pixelPad!.state())

const waitForPad = (page: Page) =>
  page.waitForFunction(() => window.__pixelPad !== undefined, undefined, { timeout: 20_000 })

/** The pad measures its own box, so wait until the layout has real numbers. */
async function waitSized(page: Page): Promise<PixelPadState> {
  await page.waitForFunction(
    () => (window.__pixelPad?.state().canvasCss.side ?? 0) > 50,
    undefined,
    { timeout: 20_000 },
  )
  return readState(page)
}

/** Centre of a grid cell in page coordinates. */
function cellCentre(state: PixelPadState, x: number, y: number): { x: number; y: number } {
  return {
    x: state.canvasCss.x + (x + 0.5) * state.cellCss,
    y: state.canvasCss.y + (y + 0.5) * state.cellCss,
  }
}

test('drawing: a real pointer drag paints a contiguous run of cells', async ({ page }) => {
  await page.goto('./#/drawing')
  await waitForPad(page)
  const state = await waitSized(page)
  expect(state.size).toBe(16)
  expect(state.blank).toBe(true)

  // Drag straight across the middle of the grid, sampling coarsely on purpose —
  // this is exactly the case Bresenham exists for. Without it the stroke comes
  // out dotted and `painted` would be far short of the cells crossed.
  const from = cellCentre(state, 2, 8)
  const to = cellCentre(state, 13, 8)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 4, from.y)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()

  const painted = (await readState(page)).painted
  expect(painted, 'a coarse drag must still paint every cell it crossed').toBeGreaterThanOrEqual(11)
  expect((await readState(page)).blank).toBe(false)
  await page.screenshot({ path: 'e2e/__screenshots__/drawing-stroke.png' })
})

test('drawing: the eraser clears painted cells and undo puts a stroke back', async ({ page }) => {
  await page.goto('./#/drawing')
  await waitForPad(page)
  const state = await waitSized(page)

  await page.evaluate(() =>
    window.__pixelPad!.paint([
      { x: 4, y: 4, color: 3 },
      { x: 5, y: 4, color: 3 },
      { x: 6, y: 4, color: 3 },
    ]),
  )
  expect((await readState(page)).painted).toBe(3)

  // Undo is one STROKE, not one cell.
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await readState(page)).painted).toBe(0)
  expect((await readState(page)).undoDepth).toBe(0)

  // Paint again, then erase one cell with a real pointer tap.
  await page.evaluate(() => window.__pixelPad!.paint([{ x: 4, y: 4, color: 3 }]))
  await page.getByRole('button', { name: 'Eraser' }).click()
  expect((await readState(page)).eraser).toBe(true)
  const cell = cellCentre(state, 4, 4)
  await page.mouse.move(cell.x, cell.y)
  await page.mouse.down()
  await page.mouse.up()
  expect((await readState(page)).painted).toBe(0)
})

test('drawing: switching grid size files the page and opens a blank one', async ({ page }) => {
  await page.goto('./#/drawing')
  await waitForPad(page)
  await waitSized(page)

  await page.evaluate(() => window.__pixelPad!.paint([{ x: 1, y: 1, color: 7 }]))
  expect((await readState(page)).painted).toBe(1)

  await page.getByRole('button', { name: 'Grid 32 by 32' }).click()
  await page.waitForFunction(() => window.__pixelPad?.state().size === 32, undefined, {
    timeout: 10_000,
  })
  const after = await waitSized(page)
  expect(after.size).toBe(32)
  expect(after.blank, 'a fresh page, not a resampled one').toBe(true)

  // …and the old page survived: it is in the gallery.
  await page.getByRole('button', { name: 'My drawings' }).click()
  const tiles = page.locator('button[aria-label^="Open drawing"]')
  await expect(tiles.first()).toBeVisible({ timeout: 10_000 })
  expect(await tiles.count()).toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: 'e2e/__screenshots__/drawing-gallery.png' })
})

test('drawing: a filed drawing survives a reload (the gallery is the fridge door)', async ({
  page,
}) => {
  await page.goto('./#/drawing')
  await waitForPad(page)
  await waitSized(page)

  await page.evaluate(() =>
    window.__pixelPad!.paint([
      { x: 2, y: 2, color: 9 },
      { x: 3, y: 3, color: 9 },
    ]),
  )
  // Done files the page and opens a fresh one.
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForFunction(() => window.__pixelPad?.state().blank === true, undefined, {
    timeout: 10_000,
  })

  await page.reload()
  await waitForPad(page)
  await waitSized(page)
  await page.getByRole('button', { name: 'My drawings' }).click()
  await expect(page.locator('button[aria-label^="Open drawing"]').first()).toBeVisible({
    timeout: 10_000,
  })
})

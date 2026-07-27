import { test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Throwaway: screenshots the easel in both consumers on both target shapes.
const DIR =
  '/private/tmp/claude-501/-Users-rostyslav-ai-vibe-ro-games/c599e487-528b-40ba-a352-daee85ae8263/scratchpad'
const SHAPES = [
  { name: 'ipad', width: 1112, height: 834 },
  { name: 'phone', width: 844, height: 390 },
]
const keepAwake = (page: Page) => page.mouse.move(200, 120 + (Date.now() % 2))

for (const shape of SHAPES) {
  test(`easel studio ${shape.name}`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: shape.width, height: shape.height })
    await page.goto('./#/drawing')
    await page.waitForFunction(() => window.__pixelPad !== undefined, undefined, {
      timeout: 20_000,
    })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${DIR}/easel-studio-${shape.name}.png` })
  })

  test(`easel commission ${shape.name}`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: shape.width, height: shape.height })
    await page.goto('./#/feed-the-monster')
    await page.waitForFunction(() => window.__feedTheMonster !== undefined, undefined, {
      timeout: 20_000,
    })
    const deadline = Date.now() + 40_000
    for (;;) {
      await keepAwake(page)
      if (await page.evaluate(() => window.__feedTheMonster!.forceCommission())) break
      if (Date.now() > deadline) throw new Error('forceCommission never accepted')
      await page.waitForTimeout(400)
    }
    await page.waitForFunction(() => window.__pixelPad !== undefined, undefined, {
      timeout: 20_000,
    })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${DIR}/easel-commission-${shape.name}.png` })
  })
}

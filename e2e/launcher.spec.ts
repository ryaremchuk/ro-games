import { test, expect } from '@playwright/test'
import { games } from '../src/games/registry'

// 8 game tiles (links) + 1 dice "surprise" tile (button) = a full 3×3 grid.
const TILE_COUNT = games.length + 1

test('launcher shows a tile per game plus the dice surprise tile', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('link')).toHaveCount(games.length)
  await expect(page.getByRole('button', { name: 'Surprise game' })).toBeVisible()
  await expect(page.locator('.home-tile')).toHaveCount(TILE_COUNT)
  await page.screenshot({ path: 'e2e/__screenshots__/launcher.png' })
})

// Tiles must shrink to fit: the launcher never scrolls, on any screen.
const viewports = [
  { name: 'iPad portrait', width: 834, height: 1112 },
  { name: 'iPad landscape', width: 1112, height: 834 },
  { name: 'iPhone portrait', width: 390, height: 844 },
  { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1728, height: 1000 },
]

for (const vp of viewports) {
  test(`launcher fits without scrolling — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('./')
    await expect(page.locator('.home-tile')).toHaveCount(TILE_COUNT)

    const overflow = await page.evaluate(() => {
      const home = document.querySelector('.home') as HTMLElement
      return {
        homeScroll: home.scrollHeight - home.clientHeight,
        docScroll: document.documentElement.scrollHeight - window.innerHeight,
      }
    })
    expect(overflow.homeScroll).toBeLessThanOrEqual(0)
    expect(overflow.docScroll).toBeLessThanOrEqual(0)

    // Every tile fully on screen, and square.
    for (const tile of await page.locator('.home-tile').all()) {
      const box = (await tile.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5)
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1)
      // Cap unchanged: tiles never exceed the old 960px-grid maximum.
      expect(box.width).toBeLessThanOrEqual(299)
    }
  })
}

test('the dice tile jumps straight into a random game', async ({ page }) => {
  const gamePaths = games.map((g) => g.path)
  await page.goto('./')
  await page.getByRole('button', { name: 'Surprise game' }).click()
  await expect
    .poll(() => new URL(page.url()).hash.replace(/^#/, ''))
    .toEqual(expect.stringMatching(new RegExp(`^(${gamePaths.join('|')})$`)))
})

test('opening a game and pressing home returns to the launcher', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Slingshot Birds' }).click()
  await expect(page).toHaveURL(/#\/slingshot$/)

  const home = page.getByRole('button', { name: 'Back to home' })
  await expect(home).toBeVisible()
  await home.click()

  await expect(page).toHaveURL(/#\/?$/)
  await expect(page.getByRole('link', { name: 'Slingshot Birds' })).toBeVisible()
})

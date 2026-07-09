import { test, expect } from '@playwright/test'
import { games } from '../src/games/registry'

test('launcher shows one tile per registered game', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('link')).toHaveCount(games.length)
  await page.screenshot({ path: 'e2e/__screenshots__/launcher.png' })
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

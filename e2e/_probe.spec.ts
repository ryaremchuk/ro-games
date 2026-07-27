import { test } from '@playwright/test'
test('probe commission state', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1112, height: 834 })
  await page.goto('./#/feed-the-monster')
  await page.waitForFunction(() => window.__feedTheMonster !== undefined, undefined, {
    timeout: 20_000,
  })
  const deadline = Date.now() + 40_000
  for (;;) {
    await page.mouse.move(200, 120 + (Date.now() % 2))
    if (await page.evaluate(() => window.__feedTheMonster!.forceCommission())) break
    if (Date.now() > deadline) throw new Error('never accepted')
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1200)
  const s = await page.evaluate(() => window.__feedTheMonster!.state())
  console.log(
    'COMMISSION:',
    JSON.stringify(s.commission),
    'tiles:',
    s.bubbleTiles,
    'foodIds:',
    JSON.stringify((s as unknown as { bubbleFoodIds?: unknown }).bubbleFoodIds),
    'round:',
    s.round,
    'kind:',
    s.taskKind,
  )
})

import { test, expect, type Page } from '@playwright/test';
import { key } from '../fixtures/analytics.js';
async function scan(page: Page, input: string) {
  await page.goto('/');
  await page.getByLabel('Mint или ссылка').fill(input);
  await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page).toHaveURL(/\/token\/.*\?job=/);
}
test('mint → persisted scan → preview → reload → report → evidence → terminal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await scan(page, key(1));
  await expect(page.getByText('Промежуточный результат скана.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toBeVisible();
  await expect(page.getByText('SYNTHETIC_TEST_FIXTURE', { exact: true })).toBeVisible();
  const holders = page.getByRole('region', { name: 'Holders', exact: true });
  await expect(holders.locator('tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(holders.locator('tbody tr')).toHaveCount(5);
  await page.getByLabel('Search holders').fill(key(10));
  await expect(holders.locator('tbody tr')).toHaveCount(1);
  const evidence = page.getByRole('button', { name: 'Open evidence' });
  await evidence.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Owner identity is not proven.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('link')).toHaveAttribute(
    'href',
    /^https:\/\/solscan.io\/tx\//,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(evidence).toBeFocused();
  for (const name of ['Axiom', 'GMGN', 'pump.fun', 'Solscan']) {
    const link = page
      .getByRole('navigation', { name: 'Terminals' })
      .getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', /^https:\/\//);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  await expect((await download).suggestedFilename()).toMatch(/^crawlspider-.*\.json$/);
  await page.getByRole('link', { name: 'Permanent report link' }).click();
  await expect(page.getByRole('heading', { name: 'Historical report' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Analysis report', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load candles' }).click();
  await expect(page.getByText('Chart unavailable:', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Early buyers' })).toBeVisible();
  await expect(page.getByText('NO_PREVIOUS_REPORT')).toBeVisible();
  await page.screenshot({ path: '.local/verification/stage09-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('Pump, GMGN and Axiom pool links resolve to the same mint and report', async ({ page }) => {
  await scan(page, `https://pump.fun/coin/${key(1)}`);
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toBeVisible();
  const first = await page
    .getByRole('link', { name: 'Permanent report link' })
    .getAttribute('href');
  await scan(page, `https://gmgn.ai/sol/token/${key(1)}`);
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toHaveAttribute(
    'href',
    first!,
  );
  await scan(page, `https://axiom.trade/meme/${key(6)}?chain=sol`);
  await expect(page).toHaveURL(new RegExp(`/token/${key(1)}\\?job=`));
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toHaveAttribute(
    'href',
    first!,
  );
});
test('provider failure and invalid input are visible', async ({ page }) => {
  await scan(page, key(2));
  await expect(page.getByText(/Scan failed/)).toBeVisible();
  await expect(page.getByText(/SYNTHETIC_PROVIDER_FAILURE/)).toBeVisible();
  await page.goto('/');
  await page.getByLabel('Mint или ссылка').fill(`https://evil.example/token/${key(1)}`);
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
test('cancellation capability survives reload but is never in the URL', async ({ page }) => {
  await scan(page, key(3));
  await expect(page.getByRole('button', { name: 'Cancel scan' })).toBeVisible();
  expect(page.url()).not.toContain('cancel');
  await page.reload();
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(page.getByText(/^Cancelled ·/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel scan' })).toHaveCount(0);
});
test('partial data cannot show a clean score; polling works when SSE fails', async ({ page }) => {
  await page.route('**/v1/scans/*/events?**', (route) => route.abort());
  await scan(page, key(4));
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toBeVisible();
  await expect(page.getByText(/Risk: Insufficient data/)).toBeVisible();
  await expect(page.getByText(/Completed with partial data/)).toBeVisible();
  await expect(page.getByText('SYNTHETIC_PARTIAL_INDEX', { exact: true }).first()).toBeVisible();
});
test('historical timestamps stay stale and chart data is separate', async ({ page }) => {
  await scan(page, key(5));
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toBeVisible();
  await expect(page.getByText(/Stale snapshot/)).toBeVisible();
  await page.route('**/v1/tokens/*/market', (route) =>
    route.fulfill({
      json: {
        status: 'available',
        mint: key(5),
        pool: key(6),
        provider: 'geckoterminal',
        observedAt: new Date().toISOString(),
        currency: 'USD',
        intervalSeconds: 300,
        reasons: [],
        candles: [
          {
            time: 1700000100,
            open: '1.0000000000000001',
            high: '2',
            low: '0.5',
            close: '1.5',
            volume: '10',
          },
          { time: 1700000400, open: '1.5', high: '3', low: '1', close: '2', volume: '20' },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: 'Load candles' }).click();
  await expect(page.getByRole('img', { name: /Свечи цены/ })).toBeVisible();
  await page.getByText('Candle table (exact source values)').click();
  await expect(
    page.getByRole('region', { name: 'USD candles' }).getByText('1.0000000000000001'),
  ).toBeVisible();
});
test('unavailable infrastructure, missing reports, watchlist and methodology remain truthful', async ({
  page,
}) => {
  await page.route('**/v1/status', (route) =>
    route.fulfill({
      json: {
        contractVersion: '1',
        status: 'degraded',
        dependencies: { postgres: true, redis: false, schema: true },
        capabilities: { rpc: false, holderIndex: false, telegram: false },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeDisabled();
  await expect(page.getByText(/Scanning is temporarily unavailable/)).toBeVisible();
  await page.goto('/report/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toContainText('Результат не найден');
  await page.goto('/watchlist');
  await expect(page.getByRole('button', { name: 'Link Telegram' })).toBeVisible();
  await page.goto('/methodology');
  await expect(page.getByText(/It is not a probability of fraud/)).toBeVisible();
  await page.goto('/status');
  await expect(page.getByText('redis: unavailable')).toBeVisible();
});
test('responsive containment, reduced motion and keyboard at mobile widths and 200% zoom', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scan(page, key(1));
  await expect(page.getByRole('link', { name: 'Permanent report link' })).toBeVisible();
  await page.goto(`/token/${key(1)}`);
  await expect(page.getByRole('heading', { name: 'Analysis report', exact: true })).toBeVisible();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: '.local/verification/stage09-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 640, height: 450 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Open evidence' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
});

import { test, expect } from '@playwright/test';
import { key } from '../fixtures/analytics.js';
test('browser confirms a Telegram link, shares persistent list/settings and revokes sessions', async ({
  page,
}) => {
  await page.goto('/watchlist');
  const begin = page.waitForResponse(
    (r) => r.url().endsWith('/v1/auth/link') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Link Telegram' }).click();
  const link = await (await begin).json();
  await expect(page.getByText(link.code, { exact: true })).toBeVisible();
  await page.request.post('http://127.0.0.1:3098/__test__/approve-link', { data: { id: link.id } });
  await expect(page.getByText('Telegram ID: 7007.', { exact: false })).toBeVisible();
  await page.getByLabel('Mint to watch').fill(key(1));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: key(1), exact: true })).toBeVisible();
  await page.getByLabel('Minimum delivery interval, minutes').fill('30');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/v1/settings') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save settings' }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel('Minimum delivery interval, minutes')).toHaveValue('30');
  await page.getByRole('button', { name: 'Revoke all website sessions' }).click();
  await expect(page.getByRole('button', { name: 'Link Telegram' })).toBeVisible();
});

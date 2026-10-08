import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>Environment check</title><p>Chromium ready</p>');
  assert.equal(await page.title(), 'Environment check');
  assert.equal(await page.locator('p').innerText(), 'Chromium ready');
  console.log(`Chromium ${browser.version()} launched successfully (environment check only).`);
} finally {
  await browser.close();
}

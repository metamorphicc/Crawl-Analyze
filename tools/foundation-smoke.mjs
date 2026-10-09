import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const children = [];
const start = (args, extra = {}) => {
  const child = spawn(process.execPath, args, { stdio: 'ignore', ...extra });
  children.push(child);
  return child;
};
const waitFor = async (url) => {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Local smoke service did not become ready');
};
let browser;
try {
  start(['apps/api/dist/index.js'], { env: { ...process.env, API_PORT: '3099' } });
  const worker = start(['apps/worker/dist/index.js']);
  start(
    [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '5199'],
    { cwd: 'apps/web' },
  );
  await waitFor('http://127.0.0.1:3099/health/ready');
  await waitFor('http://127.0.0.1:5199');
  if (worker.exitCode !== null) throw new Error('Worker exited during startup');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5199');
  await page
    .getByRole('heading', { name: 'Follow the wallets. Trace the connections.', exact: true })
    .waitFor();
  console.log('Compiled API/worker and browser frontend started successfully');
} finally {
  await browser?.close();
  for (const child of children) child.kill();
}

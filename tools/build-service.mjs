import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const service = process.argv[2];
if (service !== 'web') {
  console.error('Expected service: web');
  process.exit(1);
}
if (process.env.VERCEL === '1') {
  let valid = false;
  try {
    const url = new URL(process.env.VITE_API_URL || '');
    valid =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      !/^(localhost|.*\.localhost|127\..*|0\.0\.0\.0|\[::1\])$/.test(url.hostname);
  } catch {
    /* Report the setting name, never its potentially sensitive value. */
  }
  if (!valid) {
    console.error(
      'Set VITE_API_URL on Vercel to the public HTTPS API origin (no path, credentials or query).',
    );
    process.exit(1);
  }
}
const packages = ['contracts'];
for (const name of packages) {
  const dir = `packages/${name}`;
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, dir, 'tsconfig.json')],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'],
  { cwd: resolve(root, 'apps/web'), stdio: 'inherit' },
);
process.exit(result.status ?? 1);

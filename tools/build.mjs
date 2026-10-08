import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
for (const name of [
  'contracts',
  'config',
  'providers',
  'analysis',
  'storage',
  'api',
  'worker',
  'bot',
]) {
  const dir = `${['api', 'worker', 'bot'].includes(name) ? 'apps' : 'packages'}/${name}`;
  const result = spawnSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', `${dir}/tsconfig.json`],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
const web = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], {
  cwd: 'apps/web',
  stdio: 'inherit',
});
process.exit(web.status || 0);

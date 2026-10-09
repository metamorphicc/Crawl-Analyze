import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
const build = spawn(process.execPath, [vite, 'build'], {
  cwd,
  env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:3098' },
  stdio: 'inherit',
  windowsHide: true,
});
const code = await new Promise((resolve) => build.once('exit', resolve));
if (code !== 0) process.exit(1);
const preview = spawn(
  process.execPath,
  [vite, 'preview', '--host', '127.0.0.1', '--port', '5198', '--strictPort'],
  { cwd, stdio: 'inherit', windowsHide: true },
);
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => preview.kill(name));
preview.once('exit', (code) => process.exit(code ?? 1));

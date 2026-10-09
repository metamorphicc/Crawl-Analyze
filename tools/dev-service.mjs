import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 5173);
if (process.argv[2] !== 'web' || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Expected web service and a valid PORT');
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(port)],
  { cwd: resolve(root, 'apps/web'), stdio: 'inherit' },
);
child.on('error', () => {
  console.error('Website dev server could not start');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    child.kill(signal);
  });

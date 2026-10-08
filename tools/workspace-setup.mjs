import { readFile, writeFile } from 'node:fs/promises';
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const write = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
const packages = ['contracts', 'config', 'providers', 'analysis', 'storage'];
const dependencies = {
  providers: ['contracts', 'config'],
  analysis: ['contracts'],
  storage: ['contracts', 'config'],
  api: ['contracts', 'config', 'storage', 'providers', 'analysis'],
  worker: ['contracts', 'config', 'storage', 'providers', 'analysis'],
  bot: ['contracts', 'config', 'storage', 'providers', 'analysis'],
  web: ['contracts'],
};
for (const name of [...packages, 'api', 'worker', 'bot', 'web']) {
  const dir = `${packages.includes(name) ? 'packages' : 'apps'}/${name}`;
  const manifest = await read(`${dir}/package.json`);
  for (const dependency of dependencies[name] || [])
    manifest.dependencies[`@crawlspider/${dependency}`] = '0.0.0';
  if (name !== 'web') {
    manifest.exports = {
      '.': {
        types: './dist/index.d.ts',
        development: './src/index.ts',
        default: './dist/index.js',
      },
    };
    manifest.scripts = { build: 'tsc -p tsconfig.json' };
    await write(`${dir}/tsconfig.json`, {
      extends: '../../tsconfig.base.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist', declaration: true },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    });
  } else
    manifest.scripts = {
      dev: 'vite --mode development',
      build: 'vite build',
      preview: 'vite preview --host 127.0.0.1',
    };
  await write(`${dir}/package.json`, manifest);
}
const root = await read('package.json');
Object.assign(root.scripts, {
  typecheck: 'tsc --noEmit',
  build: 'node tools/build.mjs',
  test: 'vitest run',
  'test:integration': 'vitest run --config vitest.integration.config.ts',
  'db:migrate': 'node --conditions=development --import tsx packages/storage/src/migrate.ts',
  'dev:api': 'node --conditions=development --import tsx apps/api/src/index.ts',
  'dev:worker': 'node --conditions=development --import tsx apps/worker/src/index.ts',
  'dev:bot': 'node --conditions=development --import tsx apps/bot/src/index.ts',
  'dev:web': 'npm run dev --workspace @crawlspider/web',
  check: 'npm run typecheck && npm test && npm run build && npm run format:check',
});
await write('package.json', root);
const paths = Object.fromEntries(
  packages.map((name) => [`@crawlspider/${name}`, [`./packages/${name}/src/index.ts`]]),
);
await write('tsconfig.json', {
  extends: './tsconfig.base.json',
  compilerOptions: { noEmit: true, paths },
  include: [
    'tools/**/*.ts',
    'packages/*/src/**/*.ts',
    'apps/*/src/**/*.ts',
    'apps/web/src/**/*.tsx',
    'apps/web/vite.config.ts',
    'vitest*.ts',
    'tests/**/*.ts',
  ],
});

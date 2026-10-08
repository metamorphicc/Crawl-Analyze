import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Bootstrap only: resolve explicit latest placeholders, then retain exact versions and the lockfile.
// Normal installation uses npm ci and never invokes this script.
const manifests = ['package.json'];
for (const group of ['apps', 'packages']) {
  for (const entry of await readdir(group, { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(path.join(group, entry.name, 'package.json'));
  }
}
const documents = await Promise.all(
  manifests.map(async (file) => ({ file, data: JSON.parse(await readFile(file, 'utf8')) })),
);
const names = new Set();
for (const { data } of documents) {
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(data[section] ?? {})) {
      if (version === 'latest') names.add(name);
    }
  }
}
const versions = new Map();
const pending = [...names];
await Promise.all(
  Array.from({ length: Math.min(6, pending.length) }, async () => {
    while (pending.length) {
      const name = pending.shift();
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
        {
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error(`Registry returned ${response.status} for ${name}`);
      const metadata = await response.json();
      if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(metadata.version)) {
        throw new Error(`Invalid package version for ${name}`);
      }
      versions.set(name, metadata.version);
    }
  }),
);
for (const { file, data } of documents) {
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(data[section] ?? {})) {
      if (version === 'latest') data[section][name] = versions.get(name);
    }
  }
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`Resolved ${versions.size} dependencies to exact registry versions.`);

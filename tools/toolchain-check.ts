import assert from 'node:assert/strict';
import { address, getU64Codec } from '@solana/kit';
import { Decimal } from 'decimal.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { build } from 'vite';
import Fastify from 'fastify';
import { Bot } from 'grammy';

// Dependency compatibility check only. No scan, wallet, external request or Telegram message.
const mint = 'So11111111111111111111111111111111111111112';
assert.equal(address(mint), mint);
const raw = 9007199254740993n;
const codec = getU64Codec();
assert.equal(codec.decode(codec.encode(raw)), raw);
assert.equal(new Decimal('9007199254740993').plus(1).toFixed(), '9007199254740994');
assert.equal(z.string().parse(mint), mint);
assert.equal(typeof build, 'function');
assert.equal(typeof Bot, 'function');
const pinned = JSON.parse(await readFile('packages/providers/idl/sources.json', 'utf8')) as {
  files: { file: string; sha256: string }[];
};
for (const entry of pinned.files) {
  const bytes = await readFile(`packages/providers/idl/${entry.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const idl = JSON.parse(bytes.toString('utf8')) as { instructions: unknown[] };
  assert.ok(idl.instructions.length > 0);
}
const app = Fastify();
app.get('/health', async () => ({ ok: true }));
const response = await app.inject({ method: 'GET', url: '/health' });
assert.equal(response.statusCode, 200);
assert.deepEqual(response.json(), { ok: true });
await app.close();
console.log(
  'Toolchain compatibility verified: Solana Kit, pinned Pump IDLs, precision, API, web and bot.',
);

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '@crawlspider/config';
import { createStorage, sharedProviderBudget } from '@crawlspider/storage';
import { RpcClient, normalizeTransaction } from '@crawlspider/providers';
const config = loadConfig(),
  signature = process.argv[2];
if (
  !signature ||
  !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature) ||
  (!config.SOLANA_RPC_URL && !config.HELIUS_API_KEY)
) {
  console.log('Pending: configure RPC locally and pass a mainnet transaction signature.');
  process.exitCode = 2;
} else {
  const storage = createStorage(config);
  try {
    const rpc = new RpcClient(config, fetch, {
      budget: sharedProviderBudget(
        storage,
        config.PROVIDER_MAX_RPS,
        config.PROVIDER_DAILY_REQUEST_LIMIT,
      ),
    });
    const raw = await rpc.call(
      'getTransaction',
      [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
      AbortSignal.timeout(15000),
    );
    if (raw === null) throw new Error('Transaction unavailable');
    const normalized = normalizeTransaction(raw, signature),
      bytes = JSON.stringify(raw, null, 2);
    const dir = resolve('.local/mainnet-fixtures');
    await mkdir(dir, { recursive: true });
    const record = {
      source: 'configured-mainnet-rpc',
      capturedAt: new Date().toISOString(),
      signature,
      slot: normalized.slot,
      parserVersion: normalized.parserVersion,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      raw,
    };
    await writeFile(resolve(dir, `${signature}.json`), `${JSON.stringify(record, null, 2)}\n`, {
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        signature,
        slot: normalized.slot,
        calls: normalized.calls.map((c) => c.instruction),
        limitations: normalized.limitations,
      }),
    );
  } catch {
    console.error(
      'Mainnet capture failed; credentials redacted. Existing fixtures are never overwritten.',
    );
    process.exitCode = 1;
  } finally {
    await storage.close();
  }
}

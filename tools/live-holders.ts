import { loadConfig } from '@crawlspider/config';
import { createStorage, sharedProviderBudget } from '@crawlspider/storage';
import {
  RpcClient,
  resolveInput,
  consistentHolders,
  verifyInfrastructure,
} from '@crawlspider/providers';
const config = loadConfig();
const input = process.argv[2];
if (!input || !config.HELIUS_API_KEY) {
  console.log('Pending: supply a token mint argument and configure HELIUS_API_KEY in local .env');
  process.exitCode = 2;
} else {
  const db = createStorage(config);
  try {
    const gate = sharedProviderBudget(
      db,
      config.PROVIDER_MAX_RPS,
      config.PROVIDER_DAILY_REQUEST_LIMIT,
    );
    const rpc = new RpcClient(config, fetch, { budget: gate }),
      index = new RpcClient(config, fetch, { budget: gate, provider: 'helius' });
    const signal = AbortSignal.timeout(config.SCAN_DEEP_DEADLINE_MS);
    const resolved = await resolveInput(input, rpc, signal);
    const result = await consistentHolders(resolved.identity, index, rpc, signal, {
      maxPages: config.MAX_HOLDER_PAGES,
    });
    const infrastructure = await verifyInfrastructure(
      resolved.identity.mint,
      result.snapshot,
      rpc,
      signal,
    );
    console.log(
      JSON.stringify(
        {
          mint: resolved.identity.mint,
          accounts: result.snapshot.accountCount,
          owners: result.snapshot.ownerCount,
          pages: result.snapshot.pages,
          quality: result.snapshot.quality,
          verifiedVaults: infrastructure.evidence,
          reconciliationAttempts: result.reconciliationAttempts,
        },
        null,
        2,
      ),
    );
  } catch {
    console.error('Mainnet holder validation failed; endpoint details redacted');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

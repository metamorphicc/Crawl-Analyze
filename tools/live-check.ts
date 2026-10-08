import { loadConfig } from '@crawlspider/config';
import { RpcClient, resolveInput, WRAPPED_SOL } from '@crawlspider/providers';
const config = loadConfig();
if (!config.SOLANA_RPC_URL && !config.HELIUS_API_KEY) {
  console.log('Live verification pending: configure SOLANA_RPC_URL or HELIUS_API_KEY locally.');
  process.exitCode = 2;
} else {
  try {
    const result = await resolveInput(
      WRAPPED_SOL,
      new RpcClient(config),
      AbortSignal.timeout(15000),
    );
    console.log(
      JSON.stringify({
        check: 'mint-mainnet',
        mint: result.identity.mint,
        decimals: result.identity.decimals,
        slot: result.identity.provenance.slot,
      }),
    );
  } catch {
    console.error('Live verification failed; endpoint details redacted');
    process.exitCode = 1;
  }
}

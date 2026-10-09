import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '@crawlspider/config';
import { createStorage, sharedProviderBudget } from '@crawlspider/storage';
import { evidenceGraphSchema, type WalletLabel } from '@crawlspider/contracts';
import {
  RpcClient,
  resolveInput,
  consistentHolders,
  verifyInfrastructure,
  aggregateOwners,
  transactionReader,
  collectWalletHistories,
  readWalletHistory,
  traceFunding,
} from '@crawlspider/providers';
import {
  selectHistoryCandidates,
  counterpartyCandidates,
  summarizeWallet,
  eligibleAmount,
  buildEvidenceGraph,
} from '@crawlspider/analysis';
const config = loadConfig(),
  input = process.argv[2];
if (!input || !config.HELIUS_API_KEY || (!config.SOLANA_RPC_URL && !config.HELIUS_API_KEY)) {
  console.log('Pending: configure Helius/RPC locally and pass a mint or supported URL.');
  process.exitCode = 2;
} else {
  const storage = createStorage(config);
  try {
    const signal = AbortSignal.timeout(config.SCAN_DEEP_DEADLINE_MS),
      gate = sharedProviderBudget(
        storage,
        config.PROVIDER_MAX_RPS,
        config.PROVIDER_DAILY_REQUEST_LIMIT,
      );
    const rpc = new RpcClient(config, fetch, { budget: gate }),
      index = new RpcClient(config, fetch, { budget: gate, provider: 'helius' });
    const resolved = await resolveInput(input, rpc, signal),
      holderResult = await consistentHolders(resolved.identity, index, rpc, signal, {
        maxPages: config.MAX_HOLDER_PAGES,
      });
    const infrastructure = await verifyInfrastructure(
      resolved.identity.mint,
      holderResult.snapshot,
      rpc,
      signal,
    );
    const holders = aggregateOwners(holderResult.snapshot.accounts, infrastructure.excluded);
    const selection = selectHistoryCandidates(holders, {
      maxOwners: config.MAX_HISTORY_OWNERS,
      minOwners: 25,
      targetSupplyBps: 9500,
    });
    const options = { maxPages: 2, pageSize: 50, maxTransactions: 40, maxAccounts: 3 },
      read = transactionReader(rpc, signal);
    const collected = await collectWalletHistories(
      selection.candidates,
      rpc,
      signal,
      options,
      read,
    );
    const extras = counterpartyCandidates(
      holders,
      collected.histories,
      new Set(collected.histories.map((h) => h.owner)),
      Math.min(20, config.MAX_HISTORY_OWNERS - collected.histories.length),
    );
    const extra = await collectWalletHistories(extras, rpc, signal, options, read),
      histories = [...collected.histories, ...extra.histories];
    const signals = histories.map((h) => summarizeWallet(h, resolved.identity.mint));
    const funding = await traceFunding(
      histories,
      new Map(signals.map((s) => [s.owner, s.entry?.slot || null])),
      (owner) =>
        readWalletHistory(
          owner,
          [],
          rpc,
          signal,
          { maxPages: 1, pageSize: 20, maxTransactions: 10, maxAccounts: 0 },
          read,
        ),
      signal,
    );
    const observedAt = new Date().toISOString();
    const labels: WalletLabel[] = infrastructure.evidence.map((e) => ({
      address: e.owner,
      kind: 'pool',
      source: `RPC verified ${e.kind}: ${e.account} at slot ${e.slot}`,
      reviewedAt: observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 3600000).toISOString(),
      version: e.registryVersion,
      verified: true,
    }));
    const graph = evidenceGraphSchema.parse(
      buildEvidenceGraph({
        mint: resolved.identity.mint,
        holders,
        histories,
        signals,
        funding,
        labels,
        observedAt,
      }),
    );
    const artifact = {
      identity: holderResult.identity,
      links: resolved.links,
      snapshot: {
        ...holderResult.snapshot,
        holders,
        eligibleBalance: holders.reduce((n, h) => n + eligibleAmount(h), 0n).toString(),
      },
      infrastructure: { ...infrastructure, excluded: [...infrastructure.excluded] },
      selection: { ...selection, candidates: selection.candidates.map((h) => h.owner) },
      histories,
      signals,
      funding,
      graph,
      observedAt,
    };
    const dir = resolve('.local/evidence');
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${resolved.identity.mint}-${Date.now()}.json`);
    await writeFile(file, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
    console.log(
      JSON.stringify({
        file,
        owners: holders.length,
        selected: selection.candidates.length,
        read: histories.length,
        edges: graph.edges.length,
        controlHypotheses: graph.controlHypotheses.length,
        quality: holderResult.snapshot.quality.status,
        limitations: graph.limitations,
      }),
    );
  } catch {
    console.error('Evidence analysis failed; provider credentials redacted');
    process.exitCode = 1;
  } finally {
    await storage.close();
  }
}

import { randomUUID } from 'node:crypto';
import type { Config } from '@crawlspider/config';
import {
  CONTRACT_VERSION,
  ANALYSIS_VERSION,
  PARSER_VERSION,
  reportSchema,
  type AnalysisReport,
  type WalletHistory,
  type WalletSignals,
  type FundingTrace,
  type WalletLabel,
} from '@crawlspider/contracts';
import { sharedProviderBudget, type Storage, type Lease } from '@crawlspider/storage';
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
  discoverMarkets,
} from '@crawlspider/providers';
import {
  selectHistoryCandidates,
  counterpartyCandidates,
  summarizeWallet,
  buildEvidenceGraph,
  assessRisk,
  buildSellScenarios,
  quoteSell,
} from '@crawlspider/analysis';
export type Progress = (phase: string, preview?: AnalysisReport) => Promise<void>;
export async function runScan(
  config: Config,
  storage: Storage,
  lease: Lease,
  signal: AbortSignal,
  progress: Progress,
): Promise<AnalysisReport> {
  const budget = sharedProviderBudget(
    storage,
    config.PROVIDER_MAX_RPS,
    config.PROVIDER_DAILY_REQUEST_LIMIT,
  );
  const rpc = new RpcClient(config, fetch, { budget }),
    index = new RpcClient(config, fetch, { budget, provider: 'helius' });
  await progress('verify-mint');
  const resolved = await resolveInput(lease.mint, rpc, signal);
  await progress('holders');
  const holderResult = await consistentHolders(resolved.identity, index, rpc, signal, {
    maxPages:
      lease.mode === 'preview' ? Math.min(3, config.MAX_HOLDER_PAGES) : config.MAX_HOLDER_PAGES,
  });
  const infrastructure = await verifyInfrastructure(
    resolved.identity.mint,
    holderResult.snapshot,
    rpc,
    signal,
  );
  const holders = aggregateOwners(holderResult.snapshot.accounts, infrastructure.excluded);
  const quality = {
    ...holderResult.snapshot.quality,
    status: infrastructure.reasons.length
      ? ('partial' as const)
      : holderResult.snapshot.quality.status,
    reasons: [...new Set([...holderResult.snapshot.quality.reasons, ...infrastructure.reasons])],
  };
  await progress('markets');
  const marketResult = await discoverMarkets(
    holderResult.identity,
    rpc,
    signal,
    infrastructure.evidence.filter((e) => e.kind === 'pump-swap-vault').map((e) => e.owner),
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
  let histories: WalletHistory[] = [],
    signals: WalletSignals[] = [],
    funding: FundingTrace = {
      steps: [],
      nodesRead: 0,
      complete: false,
      reasons: ['FUNDING_NOT_READ'],
    };
  const makeReport = (extra: string[]): AnalysisReport => {
    const graph = buildEvidenceGraph({
      mint: lease.mint,
      holders,
      histories,
      signals,
      funding,
      labels,
      observedAt,
    });
    const quoteOptions = {
      observedAt,
      ...(holderResult.snapshot.quality.maxSlot
        ? { referenceSlot: holderResult.snapshot.quality.maxSlot }
        : {}),
    };
    const probe = (BigInt(holderResult.identity.supply) / 1000000n || 1n).toString();
    const risk = assessRisk({
      identity: holderResult.identity,
      holders,
      quality,
      enumerationComplete: holderResult.snapshot.enumerationComplete,
      signals,
      graph,
      observedAt,
      supportedMarket: marketResult.markets.some(
        (m) => quoteSell(m, holderResult.identity, probe, quoteOptions).status === 'available',
      ),
    });
    const scenarios = buildSellScenarios(
      holderResult.identity,
      marketResult.markets,
      risk.metrics.flaggedBalance,
      {
        ...quoteOptions,
        limitations: [
          ...marketResult.limitations,
          'FLAGGED_COHORT_IS_A_HYPOTHESIS',
          ...(holderResult.snapshot.quality.status !== 'complete'
            ? ['SCENARIO_BASIS_FROM_PARTIAL_HOLDER_SNAPSHOT']
            : []),
        ],
      },
    );
    const transactions = [
      ...new Map(histories.flatMap((h) => h.transactions).map((t) => [t.signature, t])).values(),
    ];
    return reportSchema.parse({
      id: randomUUID(),
      jobId: lease.id,
      contractVersion: CONTRACT_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      parserVersion: PARSER_VERSION,
      mode: lease.mode,
      observedAt,
      identity: holderResult.identity,
      links: resolved.links,
      snapshot: {
        holders,
        enumerationComplete: holderResult.snapshot.enumerationComplete,
        quality,
      },
      graph,
      risk,
      scenarios,
      signals,
      transactions: transactions.slice(0, 500),
      limitations: [
        ...new Set([
          ...extra,
          ...quality.reasons,
          ...marketResult.limitations,
          ...graph.limitations,
          ...(transactions.length > 500 ? ['TRANSACTION_REPORT_CAP'] : []),
        ]),
      ],
    });
  };
  const preview = makeReport(['WALLET_HISTORY_NOT_READ', 'LAUNCH_HISTORY_NOT_READ']);
  await progress('preview', preview);
  if (lease.mode === 'preview' || signal.aborted) return preview;
  await progress('wallet-history');
  const selection = selectHistoryCandidates(holders, {
    maxOwners: config.MAX_HISTORY_OWNERS,
    minOwners: 25,
    targetSupplyBps: 9500,
  });
  const options = { maxPages: 2, pageSize: 50, maxTransactions: 40, maxAccounts: 3 },
    read = transactionReader(rpc, signal);
  const collected = await collectWalletHistories(selection.candidates, rpc, signal, options, read);
  histories = collected.histories;
  const extras = counterpartyCandidates(
    holders,
    histories,
    new Set(histories.map((h) => h.owner)),
    Math.min(20, config.MAX_HISTORY_OWNERS - histories.length),
  );
  histories.push(...(await collectWalletHistories(extras, rpc, signal, options, read)).histories);
  signals = histories.map((h) => summarizeWallet(h, lease.mint));
  await progress('funding');
  funding = await traceFunding(
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
  await progress('analysis');
  return makeReport([
    'LAUNCH_HISTORY_NOT_READ',
    ...selection.reasons,
    ...collected.reasons,
    ...(signal.aborted ? ['DEEP_DEADLINE_PARTIAL'] : []),
  ]);
}

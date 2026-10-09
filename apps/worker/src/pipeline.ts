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
import { sharedProviderBudget, ScanStore, type Storage, type Lease } from '@crawlspider/storage';
import {
  RpcClient,
  terminalLinks,
  resolveInput,
  consistentHolders,
  verifyInfrastructure,
  aggregateOwners,
  transactionReader,
  collectWalletHistories,
  readWalletHistory,
  traceFunding,
  discoverMarkets,
  readLaunchWindow,
  readBlockOrders,
  readOwnerPositions,
} from '@crawlspider/providers';
import {
  selectHistoryCandidates,
  counterpartyCandidates,
  summarizeWallet,
  buildEvidenceGraph,
  assessRisk,
  buildSellScenarios,
  quoteSell,
  analyzeEarlyBuyers,
  comparePositions,
} from '@crawlspider/analysis';
import { historyPolicy } from './history-policy.js';
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
  const previous =
    lease.mode === 'deep' ? await new ScanStore(storage.pool, config).latest(lease.mint) : null;
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
  let launchWindow: WalletHistory | null = null,
    blockOrders = new Map<string, string[]>(),
    targetedBalances: NonNullable<AnalysisReport['targetedBalances']> = [];
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
      // Receipt lists are independent from the snapshot-only distribution score below.
      ...new Map(
        [...(launchWindow?.transactions || []), ...histories.flatMap((h) => h.transactions)].map(
          (t) => [t.signature, t],
        ),
      ).values(),
    ];
    const earlyBuyers = analyzeEarlyBuyers({
      mint: lease.mint,
      transactions,
      coverage: launchWindow?.coverage || null,
      holders,
      holdersComplete: holderResult.snapshot.enumerationComplete && quality.status === 'complete',
      observedAt,
      blockOrders,
    });
    const distributionRisk = assessRisk({
      identity: holderResult.identity,
      holders,
      quality,
      enumerationComplete: holderResult.snapshot.enumerationComplete,
      signals: [],
      graph: buildEvidenceGraph({
        mint: lease.mint,
        holders,
        histories: [],
        signals: [],
        funding: { steps: [], nodesRead: 0, complete: false, reasons: ['FUNDING_NOT_READ'] },
        labels,
        observedAt,
      }),
      observedAt,
      supportedMarket: false,
      scope: 'distribution',
    });
    const report = reportSchema.parse({
      id: randomUUID(),
      jobId: lease.id,
      contractVersion: CONTRACT_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      parserVersion: PARSER_VERSION,
      mode: lease.mode,
      observedAt,
      identity: holderResult.identity,
      links: terminalLinks(
        lease.mint,
        marketResult.markets.find((m) => m.venue === 'pump-swap' && m.canonical)?.address,
      ),
      snapshot: {
        holders,
        enumerationComplete: holderResult.snapshot.enumerationComplete,
        quality,
      },
      graph,
      risk,
      distributionRisk,
      scenarios,
      signals,
      transactions: transactions.slice(0, 500),
      earlyBuyers,
      targetedBalances,
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
    report.changes = comparePositions(previous, report);
    return reportSchema.parse(report);
  };
  const preview = makeReport(['WALLET_HISTORY_NOT_READ', 'LAUNCH_HISTORY_NOT_READ']);
  await progress('preview', preview);
  if (signal.aborted) return preview;
  const oldOwners = [
    ...new Set([
      ...(previous?.risk.metrics.flaggedOwners || []),
      ...(previous?.earlyBuyers?.buyers.map((b) => b.owner) || []),
    ]),
  ].slice(0, 100);
  await progress('wallet-history');
  const policy = historyPolicy(lease.mode, config);
  const historySignal = AbortSignal.any([signal, AbortSignal.timeout(policy.budgetMs)]);
  const read = transactionReader(rpc, historySignal);
  const selection = selectHistoryCandidates(holders, policy);
  const options = policy.options;
  const prior = oldOwners.slice(0, 3).map((owner) => ({
    owner,
    accounts:
      holders.find((h) => h.owner === owner)?.accounts ||
      previous?.snapshot.holders.find((h) => h.owner === owner)?.accounts ||
      [],
  }));
  const candidates = [
    ...new Map([...selection.candidates, ...prior].map((h) => [h.owner, h])).values(),
  ].slice(0, policy.maxOwners);
  let lastHistoryUpdate = 0;
  const publishHistories = async (current: WalletHistory[]) => {
    histories = current;
    signals = histories.map((h) => summarizeWallet(h, lease.mint, null));
    // Keep partial launch/funding evidence explicit; updates must not grant a final verdict.
    if (Date.now() - lastHistoryUpdate >= 1500) {
      await progress(
        'wallet-history',
        makeReport(['WALLET_HISTORY_IN_PROGRESS', 'FUNDING_NOT_READ']),
      );
      lastHistoryUpdate = Date.now();
    }
  };
  const collected = await collectWalletHistories(candidates, rpc, historySignal, options, read, {
    onUpdate: publishHistories,
  });
  histories = collected.histories;
  const sampledReasons = [
    'TARGETED_HISTORY_SAMPLE',
    'RECENT_HISTORY_WINDOW_ONLY',
    ...selection.reasons,
    ...collected.reasons,
    ...(historySignal.aborted ? ['HISTORY_SAMPLE_TIME_BUDGET'] : []),
  ];
  signals = histories.map((h) => summarizeWallet(h, lease.mint, null));
  if (lease.mode === 'preview' || signal.aborted) {
    await progress('analysis');
    return makeReport([...sampledReasons, 'LAUNCH_HISTORY_NOT_READ', 'FUNDING_NOT_READ']);
  }
  const extras = counterpartyCandidates(
    holders,
    histories,
    new Set(histories.map((h) => h.owner)),
    Math.min(2, policy.maxOwners - histories.length),
  );
  const primaryHistories = histories;
  const extraHistories = await collectWalletHistories(extras, rpc, historySignal, options, read, {
    onUpdate: (current) => publishHistories([...primaryHistories, ...current]),
  });
  histories = [...primaryHistories, ...extraHistories.histories];
  await progress('launch-history', makeReport([...sampledReasons, 'FUNDING_NOT_READ']));
  const launchSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
  launchWindow = await readLaunchWindow(
    lease.mint,
    rpc,
    launchSignal,
    transactionReader(rpc, launchSignal),
    { maxPages: 1, pageSize: 8, maxTransactions: 4, maxAccounts: 0 },
  );
  const orderSlots = launchWindow.transactions.filter((t) => !t.failed).map((t) => t.slot);
  blockOrders = await readBlockOrders(orderSlots, rpc, launchSignal);
  await progress('old-owner-positions');
  targetedBalances = await readOwnerPositions(
    oldOwners.slice(0, 3),
    lease.mint,
    rpc,
    AbortSignal.any([signal, AbortSignal.timeout(2000)]),
  );
  const launch = analyzeEarlyBuyers({
    mint: lease.mint,
    transactions: launchWindow.transactions,
    coverage: launchWindow.coverage,
    holders,
    holdersComplete: quality.status === 'complete',
    observedAt,
    blockOrders,
  }).launch;
  const early = analyzeEarlyBuyers({
    mint: lease.mint,
    transactions: [...launchWindow.transactions, ...histories.flatMap((h) => h.transactions)],
    coverage: launchWindow.coverage,
    holders,
    holdersComplete: quality.status === 'complete',
    observedAt,
    blockOrders,
  });
  signals = histories.map((h) => {
    const value = summarizeWallet(h, lease.mint, launch);
    const buyer = early.buyers.find(
      (b) => b.owner === h.owner && b.signature === value.entry?.signature,
    );
    if (
      !buyer ||
      buyer.early === null ||
      (buyer.early === false && value.earlyObservedEntry === null)
    )
      value.earlyObservedEntry = null;
    else value.earlyObservedEntry = buyer.early;
    return value;
  });
  await progress('wallet-history', makeReport(['FUNDING_NOT_READ']));
  await progress('funding');
  const fundingSignal = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
  const fundingRead = transactionReader(rpc, fundingSignal);
  funding = await traceFunding(
    histories,
    new Map(signals.map((s) => [s.owner, s.entry?.slot || null])),
    (owner) =>
      readWalletHistory(
        owner,
        [],
        rpc,
        fundingSignal,
        { maxPages: 1, pageSize: 8, maxTransactions: 4, maxAccounts: 0 },
        fundingRead,
      ),
    fundingSignal,
  );
  await progress('analysis');
  return makeReport([
    ...(launch ? [] : ['VERIFIED_LAUNCH_NOT_IN_WINDOW']),
    ...(oldOwners.length > 3 ? ['OLD_OWNER_HISTORY_CAP'] : []),
    ...sampledReasons,
    ...extraHistories.reasons,
    ...(signal.aborted ? ['DEEP_DEADLINE_PARTIAL'] : []),
  ]);
}

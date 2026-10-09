// Synthetic reports for integration/browser verification only; no application import.
import { randomUUID } from 'node:crypto';
import {
  CONTRACT_VERSION,
  ANALYSIS_VERSION,
  PARSER_VERSION,
  reportSchema,
  type AnalysisReport,
} from '@crawlspider/contracts';
import { assessRisk, buildSellScenarios } from '@crawlspider/analysis';
import { terminalLinks } from '@crawlspider/providers';
import { identity, key, NOW, emptyGraph } from './analytics.js';
import { holder, signal } from './intelligence.js';
export function fixtureReport(
  jobId: string,
  mode: 'preview' | 'deep' = 'deep',
  mint: string = key(1),
  observedAt = NOW,
): AnalysisReport {
  const token = identity();
  token.mint = mint;
  token.supply = '1000';
  token.provenance.observedAt = observedAt;
  const holders = Array.from({ length: 20 }, (_, i) => ({
    ...holder(key(i + 10), '50'),
    accounts: [key(i + 40)],
  }));
  const quality = {
    status: 'complete' as const,
    reasons: [],
    observedAt,
    minSlot: '445186127',
    maxSlot: '445186127',
    indexedSlot: '445186127',
    supplyReconciled: true,
    atomic: false as const,
  };
  const signals = holders.map((h) => ({ ...signal(h.owner), earlyObservedEntry: false }));
  const graph = emptyGraph();
  graph.nodes = holders.map((h) => ({
    owner: h.owner,
    amount: h.amount,
    label: null,
    observedHub: false,
  }));
  graph.analyzedOwners = holders.map((h) => h.owner);
  const risk = assessRisk({
    identity: token,
    holders,
    quality,
    enumerationComplete: true,
    signals,
    graph,
    observedAt,
    supportedMarket: true,
  });
  return reportSchema.parse({
    id: randomUUID(),
    jobId,
    contractVersion: CONTRACT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    parserVersion: PARSER_VERSION,
    mode,
    observedAt,
    identity: token,
    links: terminalLinks(mint),
    snapshot: { holders, enumerationComplete: true, quality },
    graph,
    risk,
    scenarios: buildSellScenarios(token, [], '0', { observedAt }),
    signals,
    transactions: [],
    limitations: ['SYNTHETIC_TEST_FIXTURE'],
  });
}

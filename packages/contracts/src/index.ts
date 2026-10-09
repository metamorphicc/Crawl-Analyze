import { z } from 'zod';

export const CONTRACT_VERSION = '1' as const;
export const ANALYSIS_VERSION = 'heuristic-1' as const;
export const PARSER_VERSION = 'pump-idl-1' as const;
export const OUTCOME_POLICY_VERSION = 'forward-1' as const;
const decimalObservation = z
  .string()
  .max(100)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/);
export const outcomeObservationSchema = z.object({
  observedAt: z.iso.datetime(),
  pool: z.string().nullable(),
  priceUsd: decimalObservation.nullable(),
  liquidityUsd: decimalObservation.nullable(),
  supply: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable(),
  slot: z.string().nullable(),
  source: z.string(),
  freshnessUpperSeconds: z.number().int().nullable(),
  reasons: z.array(z.string()),
});
export type OutcomeObservation = z.infer<typeof outcomeObservationSchema>;
export const forwardOutcomeSchema = z.object({
  policyVersion: z.literal(OUTCOME_POLICY_VERSION),
  status: z.enum(['observed', 'censored']),
  baseline: outcomeObservationSchema,
  current: outcomeObservationSchema,
  horizonSeconds: z.number().int().positive(),
  priceReturnBps: z.string().nullable(),
  liquidityChangeBps: z.string().nullable(),
  supplyDelta: z.string().nullable(),
  labels: z.object({
    marketDrawdown: z.boolean().nullable(),
    liquidityDepthDecline: z.boolean().nullable(),
    liquidityWithdrawal: z.boolean().nullable(),
    confirmedMaliciousAction: z.boolean().nullable(),
  }),
  reasons: z.array(z.string()),
});
export type ForwardOutcome = z.infer<typeof forwardOutcomeSchema>;
export const forwardHistorySchema = z.array(
  z.object({
    horizonSeconds: z.number().int().positive(),
    dueAt: z.iso.datetime(),
    result: forwardOutcomeSchema.nullable(),
  }),
);
export const rawAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const scanRequestSchema = z
  .object({
    input: z.string().trim().min(32).max(512),
    mode: z.enum(['preview', 'deep']).default('preview'),
  })
  .strict();
export const jobStateSchema = z.enum([
  'queued',
  'running',
  'complete',
  'partial',
  'failed',
  'cancelled',
]);
export type JobState = z.infer<typeof jobStateSchema>;
export type ScanRequest = z.infer<typeof scanRequestSchema>;
export const qualitySchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable']),
  reasons: z.array(z.string()),
  observedAt: z.iso.datetime(),
  minSlot: rawAmountSchema.nullable(),
  maxSlot: rawAmountSchema.nullable(),
  indexedSlot: rawAmountSchema.nullable(),
  supplyReconciled: z.boolean(),
  atomic: z.literal(false),
});
export type DataQuality = z.infer<typeof qualitySchema>;
export const provenanceSchema = z.object({
  provider: z.string(),
  observedAt: z.iso.datetime(),
  slot: rawAmountSchema.nullable(),
  commitment: z.enum(['confirmed', 'finalized']),
  parserVersion: z.string(),
});
export type Provenance = z.infer<typeof provenanceSchema>;
export const mintIdentitySchema = z.object({
  mint: addressSchema,
  program: addressSchema,
  decimals: z.number().int().min(0).max(255),
  supply: rawAmountSchema,
  mintAuthority: addressSchema.nullable(),
  freezeAuthority: addressSchema.nullable(),
  token2022Extensions: z.array(z.number().int().nonnegative()),
  provenance: provenanceSchema,
});
export type MintIdentity = z.infer<typeof mintIdentitySchema>;
export const terminalLinksSchema = z.object({
  pump: z.url(),
  axiom: z.url(),
  gmgn: z.url(),
  solscan: z.url(),
});
export type TerminalLinks = z.infer<typeof terminalLinksSchema>;
export const resolvedInputSchema = z.object({
  identity: mintIdentitySchema,
  links: terminalLinksSchema,
  source: z.enum(['mint', 'pump', 'gmgn', 'axiom']),
  pool: addressSchema.nullable(),
});
export type ResolvedInput = z.infer<typeof resolvedInputSchema>;
export const serviceStatusSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  status: z.enum(['ready', 'degraded']),
  dependencies: z.object({ postgres: z.boolean(), redis: z.boolean(), schema: z.boolean() }),
  capabilities: z.object({ rpc: z.boolean(), holderIndex: z.boolean(), telegram: z.boolean() }),
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export const notificationSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    cadenceMinutes: z.number().int().min(15).max(1440).default(15),
    utcOffsetMinutes: z.number().int().min(-720).max(840).default(0),
    quietHours: z
      .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) })
      .nullable()
      .default(null),
    riskDelta: z.number().int().min(5).max(100).default(10),
    positionDeltaBps: z.number().int().min(10).max(10000).default(100),
  })
  .strict();
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export const sessionInfoSchema = z.object({
  user: z
    .object({
      id: rawAmountSchema,
      csrf: z.string(),
      settings: notificationSettingsSchema,
      pauseReason: z.string().nullable(),
    })
    .nullable(),
});
export const linkBeginSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export const linkStatusSchema = z.object({
  state: z.enum(['pending', 'requested', 'approved', 'consumed']),
});
export const watchlistSchema = z.array(
  z.object({
    mint: addressSchema,
    lastReportId: z.uuid().nullable(),
    nextCheckAt: z.iso.datetime(),
    lastCheckAt: z.iso.datetime().nullable(),
    pendingJobId: z.uuid().nullable(),
    lastQuality: z.enum(['complete', 'partial', 'unavailable']).nullable(),
  }),
);
export const successSchema = z.object({ ok: z.literal(true) });
export const queueStatusSchema = z.object({
  capacity: z.number().int().positive(),
  lanes: z.array(
    z.object({
      lane: z.enum(['preview', 'deep', 'monitor']),
      state: z.enum(['queued', 'running']),
      count: z.number().int().nonnegative(),
    }),
  ),
});
const chartDecimal = z
  .string()
  .max(100)
  .regex(/^\d+(\.\d+)?([eE][+-]?\d+)?$/)
  .refine(
    (v) => Number.isFinite(Number(v)) && (Number(v) > 0 || /^0+(\.0+)?([eE][+-]?\d+)?$/.test(v)),
  );
export const marketChartSchema = z
  .object({
    status: z.enum(['available', 'unavailable']),
    mint: addressSchema,
    pool: addressSchema.nullable(),
    provider: z.literal('geckoterminal'),
    observedAt: z.iso.datetime(),
    currency: z.literal('USD'),
    intervalSeconds: z.literal(300),
    reasons: z.array(z.string()),
    candles: z
      .array(
        z.object({
          time: z.number().int().nonnegative().max(8640000000000),
          open: chartDecimal,
          high: chartDecimal,
          low: chartDecimal,
          close: chartDecimal,
          volume: chartDecimal,
        }),
      )
      .max(100),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === 'available'
        ? !value.pool || !value.candles.length || value.reasons.length
        : value.candles.length || !value.reasons.length
    )
      ctx.addIssue({ code: 'custom', message: 'Chart status and coverage disagree' });
    if (
      value.candles.some(
        (c, i) =>
          (i > 0 && c.time <= value.candles[i - 1]!.time) ||
          Number(c.low) > Math.min(Number(c.open), Number(c.close)) ||
          Number(c.high) < Math.max(Number(c.open), Number(c.close)),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid candle order or range' });
  });
export type MarketChart = z.infer<typeof marketChartSchema>;
export const evidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(['transfer', 'swap', 'funding', 'shared-funder', 'behavior', 'authority']),
  from: addressSchema,
  to: addressSchema,
  strength: z.enum(['onchain-interaction', 'inferred-control', 'behavioral-hypothesis']),
  signature: z.string().nullable(),
  amount: rawAmountSchema.nullable(),
  explanation: z.string(),
  provenance: provenanceSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const walletLabelSchema = z.object({
  address: addressSchema,
  kind: z.enum(['exchange', 'router', 'pool', 'distributor']),
  source: z.string().min(1),
  reviewedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  version: z.string().min(1),
  verified: z.boolean(),
});
export const relationshipEdgeSchema = evidenceSchema.extend({
  signatures: z.array(z.string()),
  transactionLinks: z.array(z.url()),
  ruleVersion: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  assetMint: addressSchema.nullable(),
  supportsControlHypothesis: z.boolean(),
  serviceExcluded: z.boolean(),
  relatedEvidenceIds: z.array(z.string()),
});
export const evidenceGraphSchema = z.object({
  ruleVersion: z.string(),
  nodes: z.array(
    z.object({
      owner: addressSchema,
      amount: rawAmountSchema,
      label: walletLabelSchema.nullable(),
      observedHub: z.boolean(),
    }),
  ),
  edges: z.array(relationshipEdgeSchema),
  controlHypotheses: z.array(
    z.object({
      id: z.string(),
      owners: z.array(addressSchema),
      amount: rawAmountSchema,
      evidenceIds: z.array(z.string()),
      confidence: z.literal('medium'),
      identityProven: z.literal(false),
    }),
  ),
  suspiciousOwners: z.array(addressSchema),
  limitations: z.array(z.string()),
  analyzedOwners: z.array(addressSchema),
});
export const jobSchema = z.object({
  id: z.uuid(),
  mint: addressSchema,
  mode: z.enum(['preview', 'deep']),
  state: jobStateSchema,
  createdAt: z.iso.datetime(),
  reportId: z.uuid().nullable(),
  errorCode: z.string().nullable(),
});
export type ScanJob = z.infer<typeof jobSchema>;
export const scanEventSchema = z.object({
  id: rawAmountSchema,
  jobId: z.uuid(),
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type ScanEvent = z.infer<typeof scanEventSchema>;
export const riskRuleSchema = z.object({
  id: z.string(),
  status: z.enum(['triggered', 'not-triggered', 'unknown']),
  points: z.number().int().min(0).max(100),
  threshold: z.string(),
  observed: z.string().nullable(),
  evidenceIds: z.array(z.string()),
});
const bpsSchema = z.number().int().min(0).max(10000);
export const riskAssessmentSchema = z
  .object({
    ruleVersion: z.string(),
    heuristic: z.literal(true),
    calibrated: z.literal(false),
    observedAt: z.iso.datetime(),
    eligible: z.boolean(),
    eligibilityReasons: z.array(z.string()),
    riskScore: z.number().int().min(0).max(100).nullable(),
    observedRiskPoints: z.number().int().min(0).max(100),
    classification: z.enum(['low', 'moderate', 'high', 'insufficient-data']),
    confidence: z.object({
      dataCompleteness: z.number().int().min(0).max(100),
      meaning: z.literal('coverage-not-predictive-accuracy'),
      reasons: z.array(z.string()),
    }),
    metrics: z.object({
      denominator: z.literal('indexed-balance-excluding-verified-infrastructure'),
      eligibleBalance: rawAmountSchema,
      excludedBalance: rawAmountSchema,
      ownerCount: z.number().int().nonnegative(),
      top1Bps: bpsSchema,
      top10Bps: bpsSchema,
      largestHypothesisBps: bpsSchema,
      flaggedBalance: rawAmountSchema,
      flaggedBps: bpsSchema,
      flaggedOwners: z.array(addressSchema),
      usableHistoryBps: bpsSchema,
      knownEntryBps: bpsSchema,
      knownEarlyEntryBps: bpsSchema,
    }),
    rules: z.array(riskRuleSchema),
  })
  .superRefine((value, ctx) => {
    if (
      value.eligible !== (value.riskScore !== null) ||
      (value.eligible &&
        (value.classification === 'insufficient-data' ||
          value.eligibilityReasons.length > 0 ||
          value.riskScore !== value.observedRiskPoints)) ||
      (!value.eligible &&
        (value.classification !== 'insufficient-data' || value.eligibilityReasons.length === 0))
    )
      ctx.addIssue({ code: 'custom', message: 'Risk eligibility and verdict disagree' });
    if (
      rawAmountSchema.safeParse(value.metrics.flaggedBalance).success &&
      rawAmountSchema.safeParse(value.metrics.eligibleBalance).success &&
      BigInt(value.metrics.flaggedBalance) > BigInt(value.metrics.eligibleBalance)
    )
      ctx.addIssue({ code: 'custom', message: 'Flagged supply exceeds eligible balance' });
  });
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;
const feeRatesSchema = z.object({
  lpBps: bpsSchema,
  protocolBps: bpsSchema,
  creatorBps: bpsSchema,
  schedule: z.enum(['sol-tier', 'stable-tier', 'exotic-flat', 'flat']),
  marketCapQuoteRaw: rawAmountSchema,
  thresholdQuoteRaw: rawAmountSchema.nullable(),
});
const quoteBaseSchema = z.object({
  modelVersion: z.string(),
  market: addressSchema,
  venue: z.enum(['pump-curve', 'pump-swap']),
  quoteMint: addressSchema,
  slot: rawAmountSchema,
  observedAt: z.iso.datetime(),
  baseIn: rawAmountSchema,
});
export const sellQuoteSchema = z.discriminatedUnion('status', [
  quoteBaseSchema.extend({ status: z.literal('unavailable'), reasons: z.array(z.string()).min(1) }),
  quoteBaseSchema.extend({
    status: z.literal('available'),
    grossQuoteOut: rawAmountSchema,
    netQuoteOut: rawAmountSchema,
    minQuoteOut: rawAmountSchema,
    slippageBps: bpsSchema,
    quoteUnits: z.string().nullable(),
    effectiveQuoteReserve: rawAmountSchema,
    realQuoteAvailable: rawAmountSchema,
    fees: z.object({
      lp: rawAmountSchema,
      protocol: rawAmountSchema,
      creator: rawAmountSchema,
      rates: feeRatesSchema,
    }),
    executionImpactBps: z.string(),
    postSpotDropBps: z.string(),
    assumptions: z.array(z.string()),
  }),
]);
export type SellQuote = z.infer<typeof sellQuoteSchema>;
export const liquidityScenariosSchema = z.object({
  modelVersion: z.string(),
  baseMint: addressSchema,
  basis: z.literal('flagged-owner-balance'),
  basisAmount: rawAmountSchema,
  observedAt: z.iso.datetime(),
  limitations: z.array(z.string()),
  scenarios: z.array(
    z.object({
      fractionBps: bpsSchema,
      baseIn: rawAmountSchema,
      quotes: z.array(sellQuoteSchema),
      routes: z.array(
        z.object({
          quoteMint: addressSchema,
          kind: z.enum(['best-single-known', 'equal-split-known']),
          legs: z.array(sellQuoteSchema),
          netQuoteOut: rawAmountSchema,
          referenceBound: z.literal('achievable-in-model-not-global-optimum'),
        }),
      ),
    }),
  ),
});
export type LiquidityScenarios = z.infer<typeof liquidityScenariosSchema>;
export const ownerBalanceSchema = z.object({
  owner: addressSchema,
  amount: rawAmountSchema,
  accounts: z.array(addressSchema),
  frozenAmount: rawAmountSchema.nullable(),
  delegatedAmount: rawAmountSchema.nullable(),
  excludedAmount: rawAmountSchema,
});
export const historyCoverageSchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable']),
  scope: z.literal('provider-retained-window'),
  addressesRequested: z.number().int().nonnegative(),
  addressesRead: z.number().int().nonnegative(),
  signatures: z.number().int().nonnegative(),
  decoded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  oldestSlot: rawAmountSchema.nullable(),
  newestSlot: rawAmountSchema.nullable(),
  exhausted: z.boolean(),
  reasons: z.array(z.string()),
});
export const entrySchema = z.object({
  signature: z.string(),
  slot: rawAmountSchema,
  kind: z.enum(['buy', 'transfer', 'mint']),
  amount: rawAmountSchema.nullable(),
});
export const walletSignalsSchema = z.object({
  owner: addressSchema,
  entry: entrySchema.nullable(),
  priorTrading: z.enum(['observed', 'none-observed-in-window', 'unknown']),
  priorTradeCount: z.number().int().nonnegative().nullable(),
  shortObservedHistory: z.boolean().nullable(),
  earlyObservedEntry: z.boolean().nullable(),
  freshWallet: z.null(),
  coverage: historyCoverageSchema,
  reasons: z.array(z.string()),
});
const decodedSchema = z.object({
  name: z.string(),
  value: z.record(z.string(), z.unknown()),
  missingFields: z.array(z.string()),
  trailingBytes: z.number().int().nonnegative(),
  trailingNonzero: z.boolean().optional(),
  accountNames: z.array(z.string()),
});
export const transactionSchema = z.object({
  signature: z.string(),
  slot: rawAmountSchema,
  blockTime: rawAmountSchema.nullable(),
  failed: z.boolean(),
  parserVersion: z.string(),
  limitations: z.array(z.string()),
  flows: z.array(
    z.object({
      kind: z.enum(['transfer', 'mint', 'burn']),
      mint: addressSchema,
      sourceAccount: addressSchema.nullable(),
      destinationAccount: addressSchema.nullable(),
      from: addressSchema.nullable(),
      to: addressSchema.nullable(),
      amount: rawAmountSchema,
      instruction: z.string(),
      provenance: provenanceSchema,
    }),
  ),
  nativeFlows: z.array(
    z.object({
      from: addressSchema,
      to: addressSchema,
      lamports: rawAmountSchema,
      instruction: z.string(),
    }),
  ),
  ownerDeltas: z.array(
    z.object({
      owner: addressSchema,
      mint: addressSchema,
      delta: z.string().regex(/^-?(0|[1-9]\d*)$/),
    }),
  ),
  calls: z.array(
    z.object({
      program: addressSchema,
      instruction: z.string(),
      accounts: z.record(z.string(), addressSchema),
      args: z.record(z.string(), z.unknown()),
      missingFields: z.array(z.string()),
      index: z.string(),
    }),
  ),
  events: z.array(z.object({ program: addressSchema, decoded: decodedSchema })),
});
export const reportSchema = z.object({
  earlyBuyers: z.lazy(() => earlyBuyersSchema).optional(),
  changes: z.lazy(() => positionComparisonSchema).optional(),
  targetedBalances: z.array(z.lazy(() => targetedBalanceSchema)).optional(),
  id: z.uuid(),
  jobId: z.uuid(),
  contractVersion: z.literal(CONTRACT_VERSION),
  analysisVersion: z.literal(ANALYSIS_VERSION),
  parserVersion: z.literal(PARSER_VERSION),
  mode: z.enum(['preview', 'deep']),
  observedAt: z.iso.datetime(),
  identity: mintIdentitySchema,
  links: terminalLinksSchema,
  snapshot: z.object({
    holders: z.array(ownerBalanceSchema),
    enumerationComplete: z.boolean(),
    quality: qualitySchema,
  }),
  graph: evidenceGraphSchema,
  risk: riskAssessmentSchema,
  scenarios: liquidityScenariosSchema,
  signals: z.array(walletSignalsSchema),
  transactions: z.array(transactionSchema),
  limitations: z.array(z.string()),
});
export type AnalysisReport = z.infer<typeof reportSchema>;
export const scanAcceptanceSchema = z.object({
  job: jobSchema,
  reused: z.boolean(),
  report: reportSchema.nullable(),
  cancelToken: z.string().nullable(),
});
export type ScanAcceptance = z.infer<typeof scanAcceptanceSchema>;
export const cancellationSchema = z.object({ cancelled: z.literal(true) });
export const jobDetailsSchema = jobSchema.extend({
  phase: z.string(),
  attempt: z.number().int().nonnegative(),
  deadlineAt: z.iso.datetime().nullable(),
  preview: reportSchema.nullable(),
});
export type JobDetails = z.infer<typeof jobDetailsSchema>;
export const launchSchema = z.object({
  signature: z.string(),
  slot: rawAmountSchema,
  instruction: z.string(),
  program: addressSchema,
});
export const earlyBuyersSchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable']),
  launch: launchSchema.nullable(),
  observedAt: z.iso.datetime(),
  reasons: z.array(z.string()),
  coverage: historyCoverageSchema.nullable(),
  buyers: z.array(
    z.object({
      owner: addressSchema,
      signature: z.string(),
      slot: rawAmountSchema,
      instruction: z.string(),
      transactionOrder: z.number().int().nonnegative().nullable(),
      amount: rawAmountSchema.nullable(),
      currentBalance: rawAmountSchema.nullable(),
      early: z.boolean().nullable(),
      entryClaim: z.enum([
        'first-observed-buy-in-covered-window',
        'earliest-observed-slot-candidate',
      ]),
    }),
  ),
});
export type EarlyBuyers = z.infer<typeof earlyBuyersSchema>;
export const positionComparisonSchema = z.object({
  previousReportId: z.uuid().nullable(),
  currentReportId: z.uuid(),
  comparable: z.boolean(),
  reasons: z.array(z.string()),
  positions: z.array(
    z.object({
      owner: addressSchema,
      before: rawAmountSchema,
      after: rawAmountSchema,
      delta: z.string().regex(/^-?(0|[1-9]\d*)$/),
      unexplainedDelta: z.string().regex(/^-?(0|[1-9]\d*)$/),
    }),
  ),
  movements: z.array(
    z.object({
      id: z.string(),
      owner: addressSchema,
      counterparty: addressSchema.nullable(),
      kind: z.enum([
        'buy',
        'sell',
        'transfer',
        'self-transfer',
        'burn',
        'mint',
        'freeze-change',
        'delegation-change',
        'trade-observed',
      ]),
      amount: rawAmountSchema.nullable(),
      signature: z.string().nullable(),
      slot: rawAmountSchema.nullable(),
      instruction: z.string().nullable(),
      controlHypothesis: z.string().nullable(),
      identityProven: z.literal(false),
      explanation: z.string(),
    }),
  ),
});
export type PositionComparison = z.infer<typeof positionComparisonSchema>;
export const targetedBalanceSchema = z.object({
  owner: addressSchema,
  amount: rawAmountSchema.nullable(),
  slot: rawAmountSchema.nullable(),
  observedAt: z.iso.datetime(),
  status: z.enum(['complete', 'unavailable']),
  reasons: z.array(z.string()),
});
export const enrichedReportSchema = reportSchema.extend({
  earlyBuyers: earlyBuyersSchema.optional(),
  changes: positionComparisonSchema.optional(),
  targetedBalances: z.array(targetedBalanceSchema).optional(),
});
export type EnrichedReport = z.infer<typeof enrichedReportSchema>;
export const recentReportsSchema = z.array(
  z.object({
    id: z.uuid(),
    mint: addressSchema,
    mode: z.enum(['preview', 'deep']),
    observedAt: z.iso.datetime(),
    state: jobStateSchema,
  }),
);
export * from './intelligence.js';
export * from './trades.js';
export class PublicError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'PublicError';
  }
}

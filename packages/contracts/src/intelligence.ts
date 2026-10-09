import type { Evidence, Provenance } from './index.js';
export type DecodedFields = {
  name: string;
  value: Record<string, unknown>;
  missingFields: string[];
  trailingBytes: number;
  trailingNonzero?: boolean;
  accountNames: string[];
};
export type ChainTransaction = {
  signature: string;
  slot: string;
  blockTime: string | null;
  failed: boolean;
  parserVersion: string;
  limitations: string[];
  flows: {
    kind: 'transfer' | 'mint' | 'burn';
    mint: string;
    sourceAccount: string | null;
    destinationAccount: string | null;
    from: string | null;
    to: string | null;
    amount: string;
    instruction: string;
    provenance: Provenance;
  }[];
  nativeFlows: { from: string; to: string; lamports: string; instruction: string }[];
  ownerDeltas: { owner: string; mint: string; delta: string }[];
  calls: {
    program: string;
    instruction: string;
    accounts: Record<string, string>;
    args: Record<string, unknown>;
    missingFields: string[];
    index: string;
  }[];
  events: { program: string; decoded: DecodedFields }[];
};
export type ChainMarket = {
  venue: 'pump-curve' | 'pump-swap';
  address: string;
  baseMint: string;
  quoteMint: string;
  quoteDecimals: number | null;
  baseReserve: string;
  quoteVaultBalance: string;
  virtualQuoteReserve: string;
  realQuoteReserve: string | null;
  canonical: boolean;
  curveComplete: boolean;
  state: DecodedFields;
  global: DecodedFields | null;
  feeConfig: DecodedFields | null;
  slot: string;
  observedAt: string;
  limitations: string[];
};
export type OwnerBalance = {
  owner: string;
  amount: string;
  accounts: string[];
  frozenAmount: string | null;
  delegatedAmount: string | null;
  excludedAmount: string;
};
export type HistoryCoverage = {
  status: 'complete' | 'partial' | 'unavailable';
  scope: 'provider-retained-window';
  addressesRequested: number;
  addressesRead: number;
  signatures: number;
  decoded: number;
  failed: number;
  missing: number;
  oldestSlot: string | null;
  newestSlot: string | null;
  exhausted: boolean;
  reasons: string[];
};
export type WalletHistory = {
  owner: string;
  transactions: ChainTransaction[];
  coverage: HistoryCoverage;
  observedAt: string;
};
export type ObservedEntry = {
  signature: string;
  slot: string;
  kind: 'buy' | 'transfer' | 'mint';
  amount: string | null;
};
export type WalletSignals = {
  owner: string;
  entry: ObservedEntry | null;
  priorTrading: 'observed' | 'none-observed-in-window' | 'unknown';
  priorTradeCount: number | null;
  shortObservedHistory: boolean | null;
  earlyObservedEntry: boolean | null;
  freshWallet: null;
  coverage: HistoryCoverage;
  reasons: string[];
};
export type FundingStep = {
  root: string;
  from: string;
  to: string;
  amount: string;
  signature: string;
  slot: string;
  hop: number;
  instruction: string;
  observedAt: string;
};
export type FundingTrace = {
  steps: FundingStep[];
  nodesRead: number;
  complete: boolean;
  reasons: string[];
};
export type WalletLabel = {
  address: string;
  kind: 'exchange' | 'router' | 'pool' | 'distributor';
  source: string;
  reviewedAt: string;
  expiresAt: string;
  version: string;
  verified: boolean;
};
export type RelationshipEdge = Evidence & {
  signatures: string[];
  transactionLinks: string[];
  ruleVersion: string;
  confidence: 'low' | 'medium' | 'high';
  assetMint: string | null;
  supportsControlHypothesis: boolean;
  serviceExcluded: boolean;
  relatedEvidenceIds: string[];
};
export type ControlHypothesis = {
  id: string;
  owners: string[];
  amount: string;
  evidenceIds: string[];
  confidence: 'medium';
  identityProven: false;
};
export type EvidenceGraph = {
  ruleVersion: string;
  nodes: { owner: string; amount: string; label: WalletLabel | null; observedHub: boolean }[];
  edges: RelationshipEdge[];
  controlHypotheses: ControlHypothesis[];
  suspiciousOwners: string[];
  limitations: string[];
  analyzedOwners: string[];
};

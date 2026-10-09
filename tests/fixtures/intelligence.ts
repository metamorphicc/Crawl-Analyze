// Synthetic public-chain-like data for deterministic tests only. Never imported by application code.
import type {
  ChainTransaction,
  WalletHistory,
  OwnerBalance,
  FundingStep,
  WalletSignals,
} from '@crawlspider/contracts';
export const tx = (signature: string, slot = '100'): ChainTransaction => ({
  signature,
  slot,
  blockTime: '100',
  failed: false,
  parserVersion: 'pump-idl-1',
  limitations: [],
  flows: [],
  nativeFlows: [],
  ownerDeltas: [],
  calls: [],
  events: [],
});
export const holder = (owner: string, amount = '10'): OwnerBalance => ({
  owner,
  amount,
  accounts: [],
  frozenAmount: '0',
  delegatedAmount: '0',
  excludedAmount: '0',
});
export const history = (owner: string, transactions: ChainTransaction[] = []): WalletHistory => ({
  owner,
  transactions,
  observedAt: '2026-10-09T00:00:00.000Z',
  coverage: {
    status: 'partial',
    scope: 'provider-retained-window',
    addressesRequested: 1,
    addressesRead: 1,
    signatures: transactions.length,
    decoded: transactions.length,
    failed: 0,
    missing: 0,
    oldestSlot: '1',
    newestSlot: '100',
    exhausted: true,
    reasons: ['ARCHIVE_COMPLETENESS_UNKNOWN'],
  },
});
export const funding = (
  root: string,
  from: string,
  signature: string,
  slot = '95',
): FundingStep => ({
  root,
  from,
  to: root,
  signature,
  slot,
  amount: '1000000',
  hop: 1,
  instruction: '0',
  observedAt: '2026-10-09T00:00:00.000Z',
});
export const signal = (owner: string, slot = '100', amount = '100'): WalletSignals => ({
  owner,
  entry: { signature: `buy-${owner}`, slot, amount, kind: 'buy' },
  priorTrading: 'unknown',
  priorTradeCount: null,
  shortObservedHistory: null,
  earlyObservedEntry: null,
  freshWallet: null,
  coverage: history(owner).coverage,
  reasons: [],
});
export const transfer = (from: string, to: string, mint: string, signature: string) => {
  const result = tx(signature);
  result.flows = [
    {
      kind: 'transfer',
      mint,
      sourceAccount: `account-${from}`,
      destinationAccount: `account-${to}`,
      from,
      to,
      amount: '10',
      instruction: '0',
      provenance: {
        provider: 'fixture',
        observedAt: '2026-10-09T00:00:00.000Z',
        slot: '100',
        commitment: 'confirmed',
        parserVersion: 'pump-idl-1',
      },
    },
  ];
  return result;
};

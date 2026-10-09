import type { ChainTransaction } from './intelligence.js';
export type ExecutedTrade = {
  mint: string;
  quoteMint: string;
  user: string;
  side: 'buy' | 'sell';
  amount: string | null;
  program: string;
  signature: string;
  slot: string;
  instruction: string;
};
// Shared pure receipt attribution. Used by decoders, change detection and early-buyer analysis.
export function extractPumpTrades(tx: ChainTransaction): ExecutedTrade[] {
  if (tx.failed) return [];
  const legCounts = new Map<string, number>(),
    deltas = new Map<string, string>(),
    receiptsByAccounts = new Map<string, ChainTransaction['flows']>();
  for (const c of tx.calls)
    if (/^(buy|sell)(_|$)/.test(c.instruction)) {
      const k = `${c.accounts.base_mint || c.accounts.mint}/${c.accounts.user}`;
      legCounts.set(k, (legCounts.get(k) || 0) + 1);
    }
  for (const d of tx.ownerDeltas) {
    const k = `${d.mint}/${d.owner}`;
    if (!deltas.has(k)) deltas.set(k, d.delta);
  }
  for (const f of tx.flows)
    if (f.kind === 'transfer') {
      const k = `${f.mint}/${f.sourceAccount}/${f.destinationAccount}`,
        list = receiptsByAccounts.get(k) || [];
      list.push(f);
      receiptsByAccounts.set(k, list);
    }
  const programs = [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  ];
  return tx.calls
    .filter((c) => programs.includes(c.program) && /^(buy|sell)(_|$)/.test(c.instruction))
    .flatMap((call) => {
      const mint = call.accounts.base_mint || call.accounts.mint,
        user = call.accounts.user;
      if (!mint || !user) return [];
      const side = call.instruction.startsWith('buy') ? ('buy' as const) : ('sell' as const);
      const legs = legCounts.get(`${mint}/${user}`) || 0;
      const delta = deltas.get(`${mint}/${user}`);
      const account =
        call.accounts.associated_base_user ||
        call.accounts.associated_user ||
        call.accounts.user_base_token_account;
      const vault =
        call.accounts.associated_base_bonding_curve ||
        call.accounts.associated_bonding_curve ||
        call.accounts.pool_base_token_account;
      const receipts =
        account && vault
          ? receiptsByAccounts.get(
              side === 'buy' ? `${mint}/${vault}/${account}` : `${mint}/${account}/${vault}`,
            ) || []
          : [];
      let amount: string | null = null;
      if (
        legs === 1 &&
        receipts.length &&
        delta !== undefined &&
        !tx.limitations.includes('ACCOUNT_OWNER_CHANGED') &&
        !tx.limitations.includes('TOKEN_2022_INSTRUCTION_UNSUPPORTED')
      ) {
        const n = receipts.reduce((n, f) => n + BigInt(f.amount), 0n);
        if (BigInt(delta) === (side === 'buy' ? n : -n)) amount = n.toString();
      }
      return [
        {
          mint,
          quoteMint: call.accounts.quote_mint || 'So11111111111111111111111111111111111111112',
          user,
          side,
          amount,
          program: call.program,
          signature: tx.signature,
          slot: tx.slot,
          instruction: call.index,
        },
      ];
    });
}

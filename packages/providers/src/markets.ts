import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { getTokenDecoder } from '@solana-program/token';
import type { MintIdentity } from '@crawlspider/contracts';
import { decodeIdl, type DecodedIdl } from './idl.js';
import { getAccount, getAccounts, type RpcTransport } from './rpc.js';
import { decodeMintIdentity } from './mint.js';
import {
  PUMP_PROGRAM,
  PUMP_AMM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  WRAPPED_SOL,
} from './input.js';
export const FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const encode = getAddressEncoder();
const seed = (text: string) => new TextEncoder().encode(text);
const key = (text: string) => new Uint8Array(encode.encode(address(text)));
export const pda = async (program: string, seeds: Uint8Array[]) =>
  (await getProgramDerivedAddress({ programAddress: address(program), seeds }))[0];
export type MarketState = {
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
  state: DecodedIdl;
  global: DecodedIdl | null;
  feeConfig: DecodedIdl | null;
  slot: string;
  observedAt: string;
  limitations: string[];
};
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export async function loadPumpCurve(
  identity: MintIdentity,
  rpc: RpcTransport,
  signal: AbortSignal,
): Promise<MarketState | null> {
  const curve = await pda(PUMP_PROGRAM, [seed('bonding-curve'), key(identity.mint)]);
  const account = await getAccount(rpc, curve, signal);
  if (!account || account.owner !== PUMP_PROGRAM) return null;
  let state = decodeIdl(PUMP_PROGRAM, 'account', account.data, true);
  if (!state || state.name !== 'BondingCurve') return null;
  const quote = text(state.value.quote_mint);
  const quoteMint = !quote || quote === '11111111111111111111111111111111' ? WRAPPED_SOL : quote;
  const globalKey = await pda(PUMP_PROGRAM, [seed('global')]),
    feeKey = await pda(FEE_PROGRAM, [seed('fee_config'), key(PUMP_PROGRAM)]);
  const [currentCurve, globalAccount, feeAccount, quoteAccount] = await getAccounts(
    rpc,
    [curve, globalKey, feeKey, quoteMint],
    signal,
  );
  if (!currentCurve || currentCurve.owner !== PUMP_PROGRAM) throw new Error('Curve disappeared');
  const current = decodeIdl(PUMP_PROGRAM, 'account', currentCurve.data, true);
  if (!current || current.name !== 'BondingCurve') throw new Error('Curve layout changed');
  const currentQuote = text(current.value.quote_mint);
  if (
    (!currentQuote || currentQuote === '11111111111111111111111111111111'
      ? WRAPPED_SOL
      : currentQuote) !== quoteMint
  )
    throw new Error('Curve quote identity changed');
  state = current;
  const global =
    globalAccount?.owner === PUMP_PROGRAM
      ? decodeIdl(PUMP_PROGRAM, 'account', globalAccount.data, true)
      : null;
  const feeConfig =
    feeAccount?.owner === FEE_PROGRAM
      ? decodeIdl(FEE_PROGRAM, 'account', feeAccount.data, true)
      : null;
  const quoteIdentity = quoteAccount ? decodeMintIdentity(quoteMint, quoteAccount) : null;
  const limitations: string[] = [];
  if (state.missingFields.length) limitations.push('LEGACY_CURVE_LAYOUT');
  if (state.trailingBytes) limitations.push('CURVE_LAYOUT_TRAILING_BYTES');
  if (state.value.is_mayhem_mode === true) limitations.push('MAYHEM_SCENARIO_UNVERIFIED');
  if (BigInt(text(state.value.depth) || '0') > 0n)
    limitations.push('MULTIHOP_CURVE_SCENARIO_UNVERIFIED');
  const base = text(state.value.virtual_token_reserves),
    virtualQuote = text(state.value.virtual_quote_reserves),
    realQuote = text(state.value.real_quote_reserves);
  if (!base || !virtualQuote || !realQuote) throw new Error('Missing core curve reserves');
  return {
    venue: 'pump-curve',
    address: curve,
    baseMint: identity.mint,
    quoteMint,
    quoteDecimals: quoteIdentity?.decimals ?? null,
    baseReserve: base,
    quoteVaultBalance: realQuote,
    virtualQuoteReserve: virtualQuote,
    realQuoteReserve: realQuote,
    canonical: true,
    curveComplete: state.value.complete === true,
    state,
    global,
    feeConfig,
    slot: currentCurve.slot,
    observedAt: new Date().toISOString(),
    limitations,
  };
}
export async function loadPumpPool(
  pool: string,
  mint: string,
  rpc: RpcTransport,
  signal: AbortSignal,
): Promise<MarketState | null> {
  const account = await getAccount(rpc, pool, signal);
  if (!account || account.owner !== PUMP_AMM_PROGRAM) return null;
  const state = decodeIdl(PUMP_AMM_PROGRAM, 'account', account.data, true);
  if (!state || state.name !== 'Pool' || state.value.base_mint !== mint) return null;
  const value = state.value;
  const creator = text(value.creator),
    quoteMint = text(value.quote_mint),
    baseVault = text(value.pool_base_token_account),
    quoteVault = text(value.pool_quote_token_account),
    index = text(value.index);
  if (!creator || !quoteMint || !baseVault || !quoteVault || !index)
    throw new Error('Missing core pool accounts');
  const indexBytes = new Uint8Array(2);
  new DataView(indexBytes.buffer).setUint16(0, Number(index), true);
  if (
    (await pda(PUMP_AMM_PROGRAM, [
      seed('pool'),
      indexBytes,
      key(creator),
      key(mint),
      key(quoteMint),
    ])) !== pool
  )
    return null;
  const globalKey = await pda(PUMP_AMM_PROGRAM, [seed('global_config')]),
    feeKey = await pda(FEE_PROGRAM, [seed('fee_config'), key(PUMP_AMM_PROGRAM)]);
  // Reread the pool with its vaults in one RPC context to avoid mixing reserves from two slots.
  const [currentPool, baseAccount, quoteAccount, globalAccount, feeAccount, quoteMintAccount] =
    await getAccounts(rpc, [pool, baseVault, quoteVault, globalKey, feeKey, quoteMint], signal);
  if (
    !currentPool ||
    currentPool.owner !== PUMP_AMM_PROGRAM ||
    !baseAccount ||
    !quoteAccount ||
    ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(baseAccount.owner) ||
    ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(quoteAccount.owner)
  )
    return null;
  const current = decodeIdl(PUMP_AMM_PROGRAM, 'account', currentPool.data, true);
  if (!current || current.name !== 'Pool') return null;
  if (
    current.value.base_mint !== mint ||
    current.value.quote_mint !== quoteMint ||
    current.value.pool_base_token_account !== baseVault ||
    current.value.pool_quote_token_account !== quoteVault ||
    current.value.creator !== creator ||
    current.value.index !== index
  )
    return null;
  const base = getTokenDecoder().decode(baseAccount.data.subarray(0, 165)),
    quote = getTokenDecoder().decode(quoteAccount.data.subarray(0, 165));
  if (base.mint !== mint || quote.mint !== quoteMint || base.owner !== pool || quote.owner !== pool)
    return null;
  const quoteIdentity = quoteMintAccount ? decodeMintIdentity(quoteMint, quoteMintAccount) : null;
  const canonicalCreator = await pda(PUMP_PROGRAM, [seed('pool-authority'), key(mint)]);
  const global =
    globalAccount?.owner === PUMP_AMM_PROGRAM
      ? decodeIdl(PUMP_AMM_PROGRAM, 'account', globalAccount.data, true)
      : null;
  const feeConfig =
    feeAccount?.owner === FEE_PROGRAM
      ? decodeIdl(FEE_PROGRAM, 'account', feeAccount.data, true)
      : null;
  const limitations: string[] = [];
  if (current.missingFields.length) limitations.push('LEGACY_POOL_LAYOUT');
  if (current.trailingBytes) limitations.push('POOL_LAYOUT_TRAILING_BYTES');
  if (quoteIdentity?.token2022Extensions.length || baseAccount.data.length > 165)
    limitations.push('TOKEN_2022_POOL_SEMANTICS_UNVERIFIED');
  return {
    venue: 'pump-swap',
    address: pool,
    baseMint: mint,
    quoteMint,
    quoteDecimals: quoteIdentity?.decimals ?? null,
    baseReserve: base.amount.toString(),
    quoteVaultBalance: quote.amount.toString(),
    virtualQuoteReserve: text(current.value.virtual_quote_reserves) || '0',
    realQuoteReserve: null,
    canonical: creator === canonicalCreator,
    curveComplete: true,
    state: current,
    global,
    feeConfig,
    slot: currentPool.slot,
    observedAt: new Date().toISOString(),
    limitations,
  };
}
export async function discoverMarkets(
  identity: MintIdentity,
  rpc: RpcTransport,
  signal: AbortSignal,
  pools: string[] = [],
) {
  const markets: MarketState[] = [];
  const limitations: string[] = [];
  try {
    const curve = await loadPumpCurve(identity, rpc, signal);
    if (curve) {
      markets.push(curve);
      if (curve.curveComplete) {
        const authority = await pda(PUMP_PROGRAM, [seed('pool-authority'), key(identity.mint)]);
        pools = [
          await pda(PUMP_AMM_PROGRAM, [
            seed('pool'),
            new Uint8Array(2),
            key(authority),
            key(identity.mint),
            key(curve.quoteMint),
          ]),
          ...pools,
        ];
      }
    }
    for (const pool of [...new Set(pools)].slice(0, 5)) {
      const market = await loadPumpPool(pool, identity.mint, rpc, signal);
      if (market) markets.push(market);
    }
  } catch {
    limitations.push(signal.aborted ? 'MARKET_DEADLINE' : 'MARKET_DATA_UNAVAILABLE');
  }
  if (!markets.some((m) => !m.curveComplete || m.venue === 'pump-swap'))
    limitations.push('ACTIVE_PUMP_VENUE_NOT_IDENTIFIED');
  return { markets, limitations };
}

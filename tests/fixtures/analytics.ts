// Synthetic market/identity states except the attributed publisher fee-account capture.
import { readFileSync } from 'node:fs';
import { getAddressDecoder } from '@solana/kit';
import { decodeIdl, FEE_PROGRAM } from '@crawlspider/providers';
import type {
  ChainMarket,
  MintIdentity,
  DecodedFields,
  EvidenceGraph,
} from '@crawlspider/contracts';
export const NOW = '2026-10-09T00:00:00.000Z';
export const key = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
export const SOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const decoded = (name: string, value: Record<string, unknown>): DecodedFields => ({
  name,
  value,
  missingFields: [],
  trailingBytes: 0,
  trailingNonzero: false,
  accountNames: [],
});
export const identity = (): MintIdentity => ({
  mint: key(1),
  program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  decimals: 6,
  supply: '1000000000000000',
  mintAuthority: null,
  freezeAuthority: null,
  token2022Extensions: [],
  provenance: {
    provider: 'synthetic',
    observedAt: NOW,
    slot: '445186127',
    commitment: 'confirmed',
    parserVersion: 'pump-idl-1',
  },
});
export const reference = JSON.parse(
  readFileSync(new URL('./pump-fee-config-mainnet.json', import.meta.url), 'utf8'),
) as {
  dataBase64: string;
  bump: number;
  admin: string;
  feeTiers: string[][];
  stableFeeTiers: string[][];
  slot: string;
};
export const feeConfig = () =>
  decodeIdl(FEE_PROGRAM, 'account', Buffer.from(reference.dataBase64, 'base64'))!;
export const market = (): ChainMarket => ({
  venue: 'pump-swap',
  address: key(2),
  baseMint: key(1),
  quoteMint: SOL,
  quoteDecimals: 9,
  baseReserve: '500000000000000',
  quoteVaultBalance: '50000000000',
  virtualQuoteReserve: '0',
  realQuoteReserve: null,
  canonical: true,
  curveComplete: true,
  state: decoded('Pool', {
    coin_creator: key(3),
    is_mayhem_mode: false,
    creator_fee_bps: '0',
    protocol_fees: '0',
    creator_fees: '0',
  }),
  global: decoded('GlobalConfig', { creator_fee_configurable: false, disable_flags: '0' }),
  feeConfig: feeConfig(),
  slot: '445186127',
  observedAt: NOW,
  limitations: [],
});
export const curve = (): ChainMarket => ({
  ...market(),
  venue: 'pump-curve',
  curveComplete: false,
  virtualQuoteReserve: '50000000000',
  realQuoteReserve: '50000000000',
  state: decoded('BondingCurve', {
    creator: key(3),
    is_mayhem_mode: false,
    creator_fee_bps: '0',
    depth: '0',
  }),
  global: decoded('Global', { creator_fee_configurable: false }),
});
export const emptyGraph = (): EvidenceGraph => ({
  ruleVersion: 'relationships-1',
  nodes: [],
  edges: [],
  controlHypotheses: [],
  suspiciousOwners: [],
  limitations: [],
  analyzedOwners: [],
});

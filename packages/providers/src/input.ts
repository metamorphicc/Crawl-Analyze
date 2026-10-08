import { address, getAddressDecoder } from '@solana/kit';
import { PublicError, type TerminalLinks } from '@crawlspider/contracts';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
export type ParsedInput = {
  address: string;
  source: 'mint' | 'pump' | 'gmgn' | 'axiom';
  mayBePool: boolean;
};
export function validAddress(value: string): string {
  try {
    return address(value);
  } catch {
    throw new PublicError('INVALID_ADDRESS', 'Expected a 32-byte Solana address');
  }
}
export function parseInput(input: string): ParsedInput {
  const text = input.trim();
  if (text.length > 512 || /\s/.test(text))
    throw new PublicError('INVALID_INPUT', 'Paste one mint address or one supported token URL');
  if (!text.includes('/')) return { address: validAddress(text), source: 'mint', mayBePool: false };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PublicError('INVALID_URL', 'Expected a complete HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new PublicError('INVALID_URL', 'Unsupported URL format');
  const parts = url.pathname.split('/').filter(Boolean);
  let candidate: string | undefined;
  let source: ParsedInput['source'];
  let mayBePool = false;
  switch (url.hostname) {
    case 'pump.fun':
    case 'www.pump.fun':
      if (parts.length !== 2 || parts[0] !== 'coin')
        throw new PublicError('UNSUPPORTED_URL', 'Use a pump.fun coin URL');
      source = 'pump';
      candidate = parts[1];
      break;
    case 'gmgn.ai':
    case 'www.gmgn.ai':
      if (parts.length !== 3 || parts[0] !== 'sol' || parts[1] !== 'token')
        throw new PublicError('UNSUPPORTED_URL', 'Use a GMGN Solana token URL');
      source = 'gmgn';
      candidate = parts[2]?.split('_').at(-1);
      break;
    case 'axiom.trade':
    case 'www.axiom.trade':
      if (
        parts.length !== 2 ||
        parts[0] !== 'meme' ||
        (url.searchParams.has('chain') && url.searchParams.get('chain') !== 'sol')
      )
        throw new PublicError('UNSUPPORTED_URL', 'Use an Axiom Solana meme URL');
      source = 'axiom';
      candidate = parts[1];
      mayBePool = true;
      break;
    default:
      throw new PublicError('UNSUPPORTED_HOST', 'Supported hosts: pump.fun, axiom.trade, gmgn.ai');
  }
  // Query referral parameters are ignored; a conflicting second token/pool is ambiguous.
  for (const [key, value] of url.searchParams) {
    if (
      ['mint', 'token', 'address', 'pair', 'pool'].includes(key.toLowerCase()) &&
      value !== candidate
    )
      throw new PublicError('AMBIGUOUS_INPUT', 'URL contains conflicting addresses');
  }
  if (!candidate) throw new PublicError('INVALID_ADDRESS', 'Missing token address');
  return { address: validAddress(candidate), source, mayBePool };
}
export function decodePumpPoolBase(data: Uint8Array): string {
  const discriminator = [241, 154, 109, 4, 17, 177, 109, 188];
  if (data.length < 211 || discriminator.some((v, i) => data[i] !== v))
    throw new PublicError('UNSUPPORTED_POOL', 'Account is not a supported PumpSwap pool');
  // Official hash-pinned Pool: discriminator + bump(u8) + index(u16) + creator(pubkey).
  return getAddressDecoder().decode(data.subarray(43, 75));
}
export function terminalLinks(mint: string, pool?: string): TerminalLinks {
  validAddress(mint);
  if (pool) validAddress(pool);
  return {
    pump: `https://pump.fun/coin/${mint}`,
    axiom: `https://axiom.trade/meme/${pool || mint}?chain=sol`,
    gmgn: `https://gmgn.ai/sol/token/${mint}`,
    solscan: `https://solscan.io/token/${mint}`,
  };
}

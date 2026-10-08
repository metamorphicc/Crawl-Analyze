import { getMintDecoder } from '@solana-program/token';
import { unwrapOption } from '@solana/kit';
import {
  mintIdentitySchema,
  PARSER_VERSION,
  PublicError,
  type MintIdentity,
} from '@crawlspider/contracts';
import { getAccount, type RpcAccount, type RpcTransport } from './rpc.js';
import {
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  PUMP_AMM_PROGRAM,
  decodePumpPoolBase,
  parseInput,
  terminalLinks,
} from './input.js';

export function decodeMintIdentity(mint: string, account: RpcAccount): MintIdentity {
  if (account.executable || ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account.owner))
    throw new PublicError('NOT_A_MINT', 'Address is not a supported SPL mint');
  const bytes = account.data;
  const extensions: number[] = [];
  if (account.owner === TOKEN_PROGRAM && bytes.length !== 82)
    throw new PublicError('NOT_A_MINT', 'Address is a token account, not a mint');
  if (account.owner === TOKEN_2022_PROGRAM && bytes.length !== 82) {
    if (bytes.length < 166 || bytes[165] !== 1)
      throw new PublicError('NOT_A_MINT', 'Invalid Token-2022 mint account');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 166; offset < bytes.length;) {
      if (bytes.subarray(offset).every((v) => v === 0)) break;
      if (offset + 4 > bytes.length)
        throw new PublicError('INVALID_MINT', 'Truncated mint extensions');
      const type = view.getUint16(offset, true),
        length = view.getUint16(offset + 2, true);
      if (!type || offset + 4 + length > bytes.length || extensions.includes(type))
        throw new PublicError('INVALID_MINT', 'Malformed mint extensions');
      extensions.push(type);
      offset += 4 + length;
    }
  }
  try {
    const value = getMintDecoder().decode(bytes.subarray(0, 82));
    if (!value.isInitialized) throw new Error('uninitialized');
    return mintIdentitySchema.parse({
      mint,
      program: account.owner,
      decimals: value.decimals,
      supply: value.supply.toString(),
      mintAuthority: unwrapOption(value.mintAuthority),
      freezeAuthority: unwrapOption(value.freezeAuthority),
      token2022Extensions: extensions,
      provenance: {
        provider: 'solana-rpc',
        observedAt: new Date().toISOString(),
        slot: account.slot,
        commitment: 'confirmed',
        parserVersion: PARSER_VERSION,
      },
    });
  } catch {
    throw new PublicError('INVALID_MINT', 'Mint account cannot be decoded');
  }
}
export async function resolveInput(input: string, rpc: RpcTransport, signal: AbortSignal) {
  const parsed = parseInput(input);
  let mint = parsed.address;
  let account = await getAccount(rpc, mint, signal);
  if (!account)
    throw new PublicError('ACCOUNT_NOT_FOUND', 'Address does not exist on Solana mainnet');
  let pool: string | undefined;
  if (parsed.mayBePool && account.owner === PUMP_AMM_PROGRAM) {
    pool = mint;
    mint = decodePumpPoolBase(account.data);
    account = await getAccount(rpc, mint, signal);
    if (!account) throw new PublicError('MINT_NOT_FOUND', 'Pool base mint could not be read');
  } else if (parsed.mayBePool && ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account.owner)) {
    throw new PublicError(
      'UNSUPPORTED_PAIR',
      'This pair is not a supported PumpSwap pool; paste its token mint',
    );
  }
  const identity = decodeMintIdentity(mint, account);
  return { identity, links: terminalLinks(mint, pool), source: parsed.source, pool: pool || null };
}

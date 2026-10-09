import { z } from 'zod';
import bs58 from 'bs58';
import { PARSER_VERSION, extractPumpTrades, type Provenance } from '@crawlspider/contracts';
import { decodeIdl, protocolIdl, type DecodedIdl } from './idl.js';
import { integerString, type RpcTransport } from './rpc.js';
import {
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  PUMP_PROGRAM,
  PUMP_AMM_PROGRAM,
  WRAPPED_SOL,
  validAddress,
} from './input.js';
const small = z
  .union([z.string().regex(/^\d{1,5}$/), z.number().int().nonnegative()])
  .transform(Number)
  .refine((n) => n <= 65535);
const balanceSchema = z.object({
  accountIndex: small,
  mint: z.string(),
  owner: z.string().optional(),
  uiTokenAmount: z.object({ amount: integerString, decimals: small }),
});
const instructionSchema = z.object({
  programIdIndex: small,
  accounts: z.array(small),
  data: z.string().max(16384),
});
const transactionSchema = z.object({
  slot: integerString,
  blockTime: z.string().nullable().optional(),
  transaction: z.object({
    signatures: z.array(z.string()),
    message: z.object({
      accountKeys: z.array(z.string()),
      instructions: z.array(instructionSchema),
    }),
  }),
  meta: z
    .object({
      err: z.unknown().nullable(),
      loadedAddresses: z
        .object({ writable: z.array(z.string()), readonly: z.array(z.string()) })
        .optional(),
      preTokenBalances: z.array(balanceSchema).nullable().optional(),
      postTokenBalances: z.array(balanceSchema).nullable().optional(),
      innerInstructions: z
        .array(z.object({ index: small, instructions: z.array(instructionSchema) }))
        .nullable()
        .optional(),
      logMessages: z.array(z.string()).nullable().optional(),
    })
    .nullable(),
});
export type TokenFlow = {
  kind: 'transfer' | 'mint' | 'burn';
  mint: string;
  sourceAccount: string | null;
  destinationAccount: string | null;
  from: string | null;
  to: string | null;
  amount: string;
  instruction: string;
  provenance: Provenance;
};
export type NativeFlow = { from: string; to: string; lamports: string; instruction: string };
export type OwnerDelta = { owner: string; mint: string; delta: string };
export type ProtocolCall = {
  program: string;
  instruction: string;
  accounts: Record<string, string>;
  args: Record<string, unknown>;
  missingFields: string[];
  index: string;
};
export type NormalizedTransaction = {
  signature: string;
  slot: string;
  blockTime: string | null;
  failed: boolean;
  flows: TokenFlow[];
  nativeFlows: NativeFlow[];
  ownerDeltas: OwnerDelta[];
  calls: ProtocolCall[];
  events: { program: string; decoded: DecodedIdl }[];
  limitations: string[];
  parserVersion: string;
};
export function normalizeTransaction(
  raw: unknown,
  expectedSignature?: string,
): NormalizedTransaction {
  const tx = transactionSchema.parse(raw);
  const signature = tx.transaction.signatures[0];
  if (!signature || (expectedSignature && expectedSignature !== signature))
    throw new Error('Transaction signature mismatch');
  const output: NormalizedTransaction = {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime || null,
    failed: false,
    flows: [],
    nativeFlows: [],
    ownerDeltas: [],
    calls: [],
    events: [],
    limitations: [],
    parserVersion: PARSER_VERSION,
  };
  if (!tx.meta) {
    output.limitations.push('TRANSACTION_META_UNAVAILABLE');
    return output;
  }
  if (tx.meta.err !== null) {
    output.failed = true;
    return output;
  }
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || []),
  ];
  keys.forEach(validAddress);
  const balances = new Map<number, { mint: string; owner: string | null }>();
  const deltas = new Map<string, bigint>();
  const ambiguous = new Set<number>();
  const pre = tx.meta.preTokenBalances,
    post = tx.meta.postTokenBalances;
  if (!pre || !post) output.limitations.push('TOKEN_BALANCES_UNAVAILABLE');
  for (const [side, rows] of [
    [-1n, pre],
    [1n, post],
  ] as const)
    for (const row of rows || []) {
      if (!keys[row.accountIndex]) {
        output.limitations.push('BALANCE_ACCOUNT_INDEX_INVALID');
        continue;
      }
      validAddress(row.mint);
      if (row.owner) validAddress(row.owner);
      const previous = balances.get(row.accountIndex);
      if (
        previous &&
        (previous.mint !== row.mint ||
          (previous.owner && row.owner && previous.owner !== row.owner))
      ) {
        output.limitations.push('ACCOUNT_OWNER_CHANGED');
        ambiguous.add(row.accountIndex);
      }
      balances.set(row.accountIndex, {
        mint: row.mint,
        owner: row.owner || previous?.owner || null,
      });
      if (row.owner) {
        const id = `${row.owner}:${row.mint}`;
        deltas.set(id, (deltas.get(id) || 0n) + side * BigInt(row.uiTokenAmount.amount));
      } else output.limitations.push('TOKEN_OWNER_UNAVAILABLE');
    }
  if (pre && post)
    output.ownerDeltas = [...deltas].map(([id, delta]) => {
      const [owner, mint] = id.split(':');
      return { owner: owner!, mint: mint!, delta: delta.toString() };
    });
  const provenance: Provenance = {
    provider: 'solana-rpc',
    observedAt: new Date().toISOString(),
    slot: tx.slot,
    commitment: 'confirmed',
    parserVersion: PARSER_VERSION,
  };
  const all = [
    ...tx.transaction.message.instructions.map((ix, i) => ({ ix, index: String(i) })),
    ...(tx.meta.innerInstructions || []).flatMap((g) =>
      g.instructions.map((ix, i) => ({ ix, index: `${g.index}.${i}` })),
    ),
  ];
  for (const { ix, index } of all) {
    const program = keys[ix.programIdIndex];
    const accounts = ix.accounts.map((i) => keys[i]);
    if (!program || accounts.some((a) => !a)) {
      output.limitations.push('INSTRUCTION_ACCOUNT_INDEX_INVALID');
      continue;
    }
    let data: Uint8Array;
    try {
      data = bs58.decode(ix.data);
    } catch {
      output.limitations.push('INSTRUCTION_DATA_INVALID');
      continue;
    }
    try {
      if (protocolIdl(program)) {
        const eventTag = [228, 69, 165, 46, 81, 203, 154, 29];
        if (eventTag.every((v, i) => data[i] === v)) {
          const decoded = decodeIdl(program, 'event', data.subarray(8), true);
          if (decoded) output.events.push({ program, decoded });
          else output.limitations.push('PROTOCOL_EVENT_UNKNOWN');
          continue;
        }
        const decoded = decodeIdl(program, 'instruction', data, true);
        if (!decoded) {
          output.limitations.push('PROTOCOL_INSTRUCTION_UNKNOWN');
          continue;
        }
        const mapped = Object.fromEntries(
          decoded.accountNames.flatMap((name, i) => (accounts[i] ? [[name, accounts[i]!]] : [])),
        );
        output.calls.push({
          program,
          instruction: decoded.name,
          accounts: mapped,
          args: decoded.value,
          missingFields: decoded.missingFields,
          index,
        });
        if (decoded.trailingBytes) output.limitations.push('PROTOCOL_INSTRUCTION_TRAILING_DATA');
      } else if (program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) {
        const tag = data[0];
        const checked = tag === 12 || tag === 14 || tag === 15;
        if (![3, 7, 8, 12, 14, 15].includes(tag!)) {
          if (tag !== undefined && tag > 25)
            output.limitations.push('TOKEN_2022_INSTRUCTION_UNSUPPORTED');
          continue;
        }
        if (data.length !== (checked ? 10 : 9)) throw new Error('truncated token instruction');
        const amount = new DataView(data.buffer, data.byteOffset + 1, 8)
          .getBigUint64(0, true)
          .toString();
        const source = tag === 7 || tag === 14 ? null : ix.accounts[0];
        const destination =
          tag === 8 || tag === 15 ? null : ix.accounts[checked && tag === 12 ? 2 : 1];
        const mint =
          tag === 7 || tag === 14
            ? accounts[0]
            : tag === 8 || tag === 15 || tag === 12
              ? accounts[1]
              : balances.get(source!)?.mint;
        if (
          !mint ||
          (source !== null && source === undefined) ||
          (destination !== null && destination === undefined)
        ) {
          output.limitations.push('TOKEN_FLOW_MINT_UNAVAILABLE');
          continue;
        }
        const from =
            source === null || ambiguous.has(source!) ? null : balances.get(source!)?.owner || null,
          to =
            destination === null || ambiguous.has(destination!)
              ? null
              : balances.get(destination!)?.owner || null;
        if ((source !== null && !from) || (destination !== null && !to))
          output.limitations.push('TOKEN_FLOW_OWNER_UNAVAILABLE');
        output.flows.push({
          kind: source === null ? 'mint' : destination === null ? 'burn' : 'transfer',
          mint,
          sourceAccount: source === null ? null : keys[source!] || null,
          destinationAccount: destination === null ? null : keys[destination!] || null,
          from,
          to,
          amount,
          instruction: index,
          provenance,
        });
      } else if (
        program === '11111111111111111111111111111111' &&
        data.length === 12 &&
        new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) === 2
      ) {
        if (accounts[0] && accounts[1])
          output.nativeFlows.push({
            from: accounts[0],
            to: accounts[1],
            lamports: new DataView(data.buffer, data.byteOffset + 4, 8)
              .getBigUint64(0, true)
              .toString(),
            instruction: index,
          });
      }
    } catch {
      output.limitations.push('INSTRUCTION_DECODE_FAILED');
    }
  }
  const stack: string[] = [];
  for (const line of tx.meta.logMessages || []) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    const finish = /^Program (\w+) (?:success|failed:.*)$/.exec(line);
    if (finish) {
      if (stack.at(-1) === finish[1]) stack.pop();
      else {
        stack.length = 0;
        output.limitations.push('LOG_STACK_INCONSISTENT');
      }
      continue;
    }
    if (line.startsWith('Program data: ') && stack.at(-1) && protocolIdl(stack.at(-1)!)) {
      try {
        const data = Buffer.from(line.slice(14), 'base64');
        const decoded = decodeIdl(stack.at(-1)!, 'event', data, true);
        if (decoded) output.events.push({ program: stack.at(-1)!, decoded });
      } catch {
        output.limitations.push('PROTOCOL_EVENT_DECODE_FAILED');
      }
    }
  }
  output.limitations = [...new Set(output.limitations)];
  return output;
}
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
export function executedTrades(tx: NormalizedTransaction): ExecutedTrade[] {
  return extractPumpTrades(tx);
}
export async function getTransaction(rpc: RpcTransport, signature: string, signal: AbortSignal) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
    throw new Error('Invalid transaction signature');
  const raw = await rpc.call(
    'getTransaction',
    [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    signal,
  );
  return raw === null ? null : normalizeTransaction(raw, signature);
}

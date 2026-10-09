import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  getAddressDecoder,
  getU64Decoder,
  getI64Decoder,
  getU128Decoder,
  getI128Decoder,
} from '@solana/kit';
import { ProviderError } from './rpc.js';
type Field = { name: string; type: IdlType };
type IdlType =
  | string
  | { array: [IdlType, number] }
  | { vec: IdlType }
  | { option: IdlType }
  | { defined: { name: string } };
type Definition = {
  name: string;
  type: {
    kind: string;
    fields?: (Field | IdlType)[];
    variants?: { name: string; fields?: (Field | IdlType)[] }[];
  };
};
type Entry = {
  name: string;
  discriminator: number[];
  args?: Field[];
  accounts?: { name: string; accounts?: { name: string }[] }[];
};
export type ProtocolIdl = {
  address: string;
  instructions: Entry[];
  accounts: Entry[];
  events: Entry[];
  types: Definition[];
};
const cache = new Map<string, ProtocolIdl>();
let loaded = false;
export function protocolIdl(program: string): ProtocolIdl | null {
  if (loaded) return cache.get(program) || null;
  const sources = JSON.parse(
    readFileSync(new URL('../idl/sources.json', import.meta.url), 'utf8'),
  ) as { files: { file: string; sha256: string }[] };
  for (const entry of sources.files) {
    const bytes = readFileSync(new URL(`../idl/${entry.file}`, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error('Protocol IDL integrity failed');
    const idl = JSON.parse(bytes.toString()) as ProtocolIdl;
    cache.set(idl.address, idl);
  }
  loaded = true;
  return cache.get(program) || null;
}
class Reader {
  offset = 0;
  constructor(
    readonly bytes: Uint8Array,
    readonly idl: ProtocolIdl,
  ) {}
  take(size: number) {
    if (size < 0 || this.offset + size > this.bytes.length)
      throw new ProviderError('TRUNCATED_BORSH');
    const v = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return v;
  }
  byte() {
    return this.take(1)[0]!;
  }
  length() {
    const b = this.take(4);
    const n = new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
    if (n > 4096) throw new ProviderError('BORSH_COLLECTION_LIMIT');
    return n;
  }
  value(type: IdlType, depth = 0): unknown {
    if (depth > 12) throw new ProviderError('BORSH_DEPTH_LIMIT');
    if (typeof type === 'string') {
      switch (type) {
        case 'pubkey':
          return getAddressDecoder().decode(this.take(32));
        case 'u64':
          return getU64Decoder().decode(this.take(8)).toString();
        case 'i64':
          return getI64Decoder().decode(this.take(8)).toString();
        case 'u128':
          return getU128Decoder().decode(this.take(16)).toString();
        case 'i128':
          return getI128Decoder().decode(this.take(16)).toString();
        case 'u8':
          return String(this.byte());
        case 'u16': {
          const b = this.take(2);
          return String(new DataView(b.buffer, b.byteOffset, 2).getUint16(0, true));
        }
        case 'u32': {
          const b = this.take(4);
          return String(new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true));
        }
        case 'bool': {
          const b = this.byte();
          if (b > 1) throw new ProviderError('INVALID_BORSH_BOOL');
          return b === 1;
        }
        case 'string':
          return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.length()));
        default:
          throw new ProviderError('UNSUPPORTED_BORSH_TYPE');
      }
    }
    if ('array' in type) {
      if (type.array[1] > 4096) throw new ProviderError('BORSH_COLLECTION_LIMIT');
      return Array.from({ length: type.array[1] }, () => this.value(type.array[0], depth + 1));
    }
    if ('vec' in type)
      return Array.from({ length: this.length() }, () => this.value(type.vec, depth + 1));
    if ('option' in type) {
      const tag = this.byte();
      if (tag > 1) throw new ProviderError('INVALID_BORSH_OPTION');
      return tag ? this.value(type.option, depth + 1) : null;
    }
    const definition = this.idl.types.find((t) => t.name === type.defined.name);
    if (!definition) throw new ProviderError('UNKNOWN_BORSH_DEFINITION');
    if (definition.type.kind === 'struct')
      return this.fields(definition.type.fields || [], false, depth + 1).value;
    if (definition.type.kind === 'enum') {
      const variant = definition.type.variants?.[this.byte()];
      if (!variant) throw new ProviderError('INVALID_BORSH_ENUM');
      return {
        variant: variant.name,
        ...this.fields(variant.fields || [], false, depth + 1).value,
      };
    }
    throw new ProviderError('UNSUPPORTED_BORSH_DEFINITION');
  }
  fields(input: (Field | IdlType)[], prefix: boolean, depth = 0) {
    const value: Record<string, unknown> = {};
    const missingFields: string[] = [];
    const fields = input.map((field, i): Field =>
      typeof field === 'object' && 'name' in field && 'type' in field
        ? field
        : { name: String(i), type: field },
    );
    for (const [i, field] of fields.entries()) {
      if (prefix && this.offset === this.bytes.length) {
        missingFields.push(...fields.slice(i).map((f) => f.name));
        break;
      }
      value[field.name] = this.value(field.type, depth + 1);
    }
    return { value, missingFields };
  }
}
export type DecodedIdl = {
  name: string;
  value: Record<string, unknown>;
  missingFields: string[];
  trailingBytes: number;
  accountNames: string[];
};
export function decodeIdl(
  program: string,
  kind: 'account' | 'event' | 'instruction',
  bytes: Uint8Array,
  allowLegacyPrefix = false,
): DecodedIdl | null {
  const idl = protocolIdl(program);
  if (!idl) return null;
  const list = kind === 'account' ? idl.accounts : kind === 'event' ? idl.events : idl.instructions;
  const entry = list.find((v) => v.discriminator.every((b, i) => bytes[i] === b));
  if (!entry) return null;
  const reader = new Reader(bytes, idl);
  reader.take(entry.discriminator.length);
  const fields =
    kind === 'instruction'
      ? entry.args || []
      : idl.types.find((t) => t.name === entry.name)?.type.fields;
  if (!fields) throw new ProviderError('IDL_FIELDS_UNAVAILABLE');
  const decoded = reader.fields(fields, allowLegacyPrefix);
  return {
    name: entry.name,
    ...decoded,
    trailingBytes: bytes.length - reader.offset,
    accountNames: (entry.accounts || []).flatMap((a) =>
      a.accounts ? a.accounts.map((v) => v.name) : [a.name],
    ),
  };
}

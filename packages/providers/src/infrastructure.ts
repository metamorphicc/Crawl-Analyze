import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from '@solana/kit';
import { getTokenDecoder } from '@solana-program/token';
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './input.js';
import { getAccounts, type RpcTransport } from './rpc.js';
import type { HolderSnapshot } from './holders.js';
const keyDecoder = getAddressDecoder(),
  keyEncoder = getAddressEncoder();
export type InfrastructureEvidence = {
  account: string;
  owner: string;
  mint: string;
  kind: 'bonding-curve-vault' | 'pump-swap-vault';
  registryVersion: 'pump-infrastructure-1';
  program: string;
  slot: string;
  verifiedBy: string[];
};
export async function verifyInfrastructure(
  mint: string,
  snapshot: Pick<HolderSnapshot, 'accounts' | 'holders'>,
  rpc: RpcTransport,
  signal: AbortSignal,
  maxOwners = 20,
) {
  const excluded = new Set<string>();
  const evidence: InfrastructureEvidence[] = [];
  const reasons: string[] = [];
  try {
    const [curve] = await getProgramDerivedAddress({
      programAddress: address(PUMP_PROGRAM),
      seeds: [new TextEncoder().encode('bonding-curve'), keyEncoder.encode(address(mint))],
    });
    const keys = [...new Set([curve, ...snapshot.holders.slice(0, maxOwners).map((h) => h.owner)])];
    const accounts = await getAccounts(rpc, keys, signal);
    for (const [index, owner] of keys.entries()) {
      const account = accounts[index];
      if (!account || account.executable) continue;
      let kind: InfrastructureEvidence['kind'] | undefined;
      let expectedVault: string | undefined;
      if (
        owner === curve &&
        account.owner === PUMP_PROGRAM &&
        account.data.length >= 81 &&
        [23, 183, 248, 55, 96, 216, 172, 96].every((v, i) => account.data[i] === v)
      )
        kind = 'bonding-curve-vault';
      else if (
        account.owner === PUMP_AMM_PROGRAM &&
        account.data.length >= 211 &&
        [241, 154, 109, 4, 17, 177, 109, 188].every((v, i) => account.data[i] === v)
      ) {
        const base = keyDecoder.decode(account.data.subarray(43, 75));
        if (base !== mint) continue;
        const [pool] = await getProgramDerivedAddress({
          programAddress: address(PUMP_AMM_PROGRAM),
          seeds: [
            new TextEncoder().encode('pool'),
            account.data.subarray(9, 11),
            account.data.subarray(11, 43),
            account.data.subarray(43, 75),
            account.data.subarray(75, 107),
          ],
        });
        if (pool !== owner) {
          reasons.push('POOL_PDA_MISMATCH');
          continue;
        }
        expectedVault = keyDecoder.decode(account.data.subarray(139, 171));
        kind = 'pump-swap-vault';
      }
      if (!kind) continue;
      const rows = snapshot.accounts.filter(
        (a) => a.owner === owner && (!expectedVault || a.address === expectedVault),
      );
      if (rows.length > 100) {
        reasons.push('INFRASTRUCTURE_VAULT_LIMIT');
        continue;
      }
      if (!rows.length) continue;
      const vaults = await getAccounts(
        rpc,
        rows.map((r) => r.address),
        signal,
      );
      for (const [i, row] of rows.entries()) {
        const vault = vaults[i];
        if (
          !vault ||
          ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(vault.owner) ||
          vault.data.length < 165
        )
          continue;
        if (vault.owner === TOKEN_2022_PROGRAM && vault.data.length > 165 && vault.data[165] !== 2)
          continue;
        const token = getTokenDecoder().decode(vault.data.subarray(0, 165));
        if (token.mint !== mint || token.owner !== owner) continue;
        if (token.amount.toString() !== row.amount) {
          reasons.push('VAULT_BALANCE_CHANGED');
          continue;
        }
        excluded.add(row.address);
        evidence.push({
          account: row.address,
          owner,
          mint,
          kind,
          registryVersion: 'pump-infrastructure-1',
          program: account.owner,
          slot: vault.slot,
          verifiedBy: [
            'program-owner',
            'account-discriminator',
            'derived-pda',
            'vault-mint',
            'vault-authority',
            'vault-balance',
          ],
        });
      }
    }
    if (snapshot.holders.length > maxOwners) reasons.push('INFRASTRUCTURE_OWNER_COVERAGE_LIMIT');
  } catch {
    reasons.push(
      signal.aborted ? 'INFRASTRUCTURE_DEADLINE' : 'INFRASTRUCTURE_VERIFICATION_UNAVAILABLE',
    );
  }
  return { excluded, evidence, reasons: [...new Set(reasons)] };
}

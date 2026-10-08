# Stage 03 verification and limits

Helius pagination follows the [official DAS contract](https://www.helius.dev/docs/api-reference/das/gettokenaccounts).
Amounts are parsed losslessly, restricted to u64 and aggregated by canonical owner. A page's `total`
is not treated as a global snapshot total. Cursor/page loops, duplicates, changed balances, missing
index slots, slot drift, page caps and unavailable pages produce explicit partial quality. Even a
reconciled enumeration has `atomic: false`: the index does not promise one historical snapshot.
One bounded reconciliation rereads the mint and enumerates again when a full read drifts.

The latest index watermark is compared with [confirmed RPC slot](https://solana.com/docs/rpc/http/getslot).
Supply reconciliation includes vault holdings. Verified vaults are excluded separately from the
eligible distribution denominator; burned supply is not guessed. WSOL native supply and unreviewed
Token-2022 semantics cannot earn a clean verdict. Missing frozen/delegation metadata stays null.

Infrastructure exclusions require the derived Pump/PumpSwap PDA, program owner, discriminator,
vault mint/authority and matching balance. Only verified token accounts are excluded; a shared
owner does not erase unrelated balances. Owner verification is bounded (20 by default) and records
that coverage limit. Unknown venues/accounts are retained and qualified.

Application RPC calls share a Redis rate gate and PostgreSQL UTC daily request counter. The limit
counts attempts (including retries), not monetary credits: provider methods have different tariffs.
No promise of a currency spend cap is made without a configured provider tariff. Helius RPC and DAS
use the same budget namespace. Two attempts maximum per endpoint, failover, circuit cooldown,
8 MiB body ceiling, cancellation and absolute caller deadline are enforced. Diagnostics alone use a
process-local gate; services must inject the durable gate.

Local verification: pagination/precision/failure fixtures, RPC fallback, individual vault checks,
and an integration test proving independent gate instances share the persisted daily cap.
Live provider capability/reconciliation remains pending local keys. Run an appropriately sized
token through `node --conditions=development --import tsx tools/live-holders.ts <mint>` to capture
quality and verified vault evidence. No fixture result is represented as live data.

# Stage 04 — decoding and market state

Implemented hash-verified official IDL Borsh decoding (including tuple fields, signed i128,
bounded vectors, legacy prefixes and explicit unknown appended fields). Normalized JSON transactions
include ALT writable/readonly keys, inner CPI, SPL transfer/mint/burn, native transfers, owner deltas,
protocol calls and invocation-stack-attributed events. Failed transactions produce no execution
evidence. A missing receipt or changed token-account authority stays unknown. Actual trade amounts
require a matching venue transfer and consistent owner delta; a net delta alone is insufficient.

Pump/PumpSwap market discovery verifies program/PDA, mint, vault authority, quote identity and
rereads market/vault state in one RPC context. Current fee/global accounts are retained for stage 06;
quotes are not produced yet. Signed virtual quote adjustments are preserved without float conversion.
Other migrated venues retain distribution/flow analysis, with scenario unavailable until a venue
adapter is verified. See `VENUE_CAPABILITIES.md`.

Checks cover legacy and modern buy/sell/v2/v3/migration instruction variants, exact large balances,
negative i128, malformed Borsh, CPI+ALT transfers, mint/burn, failed transactions, missing owners,
authority changes, router log spoofing, ambiguous receipts and pool/vault context verification.
All fixtures are deterministic synthetic inputs, not claims of mainnet execution.

Live acceptance remains pending: `npm run doctor` reports no local Helius/RPC keys. The mainnet golden
corpus must contain curve, AMM, migration, terminal-routed, multi-hop, failed and extension cases.
Use `node --conditions=development --import tsx tools/capture-mainnet.ts <signature>` to save an
attributed, hashed, lossless fixture in ignored `.local/mainnet-fixtures/`. No endpoint/secret is saved.
Review and promote public fixtures separately after credentials exist. This implementation checkpoint
does not claim the live golden-corpus gate passed.

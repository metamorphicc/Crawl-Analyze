# Targeted scans and independent market charts

2026-10-09. Local change; no push/deployment and no production process restart.
One verified idle stale agent-started source worker was stopped to remove a duplicate. The user's
compiled worker and API were left running and still need to be restarted for the new build.

## User-visible repair

The default website action is Quick scan (`preview`): holder distribution, verified mint
authorities/account flags and a recent-history sample of at most six large holders. Extended
scan (`deep`) samples at most twelve holders, then adds separately bounded launch, old-position
and funding reads. Selection aims at 95% of indexed eligible balance and stops after at least
two/three owners when that target is met. A lower configured MAX_HISTORY_OWNERS is respected.
All indexed holders remain in the report; selection affects history IO only. No rate-limit increase.

History has a 6s/20s phase budget, one signature page per address, one token account per owner,
and at most 4/8 transaction reads per owner. The parent's scan cancellation/deadline still wins.
Extended extra counterparties share the same budget and twelve-owner ceiling. Launch reads are
bounded to 3s/four receipts, prior positions to three owners/2s and funding to 2.5s. Missing,
unexamined and truncated observations remain explicitly unknown; this is not lifetime history.

`distribution-1` is a separate, optional snapshot-only risk assessment in the report. It requires
complete, fresh, reconciled holder balances, reviewed mint semantics and known account flags.
It scores concentration, mint/freeze authority and frozen/delegated balances; it does not assert
coverage of trading, common control, early buyers or liquidity. The original `heuristic-1`
extended assessment and its coverage gates remain. The UI names the distinction, shows an eligible
distribution score and still lists extended coverage limits. Partial snapshots cannot get a clean
distribution verdict; positive observed points can be shown distinctly from an unavailable score.

SPL Token-2022 MetadataPointer (18) and TokenMetadata (19) describe metadata, rather than changing
raw transfer/balance semantics. Pointer length and embedded metadata mint are checked. Those two
extensions no longer blanket-disable holder reconciliation, authority assessment or sell math.
Transfer fees/hooks, confidential balances, permanent delegates and unknown extensions remain
ineligible. Pool token-account extension semantics remain conservative and separate.

Charts independently discover an external pool from GeckoTerminal's token-pool endpoint if no
PumpSwap quote identifies a pool. Pool relationships and candle metadata must match the mint.
This is display enrichment; it never verifies chain reserves or enables an unsupported sell model.
Response size, timeouts, fixed host/no redirects, the shared provider budget and cross-process
gate remain enforced. There are at most two provider calls per gated enrichment; pool/cache TTLs
are 300s/60s. Temporary source/gate failures get at most three automatic frontend retries.

## Live evidence

Same mint as the user's screenshots: `E71f3Ph24bCiG2kGL1M3ywJV1yMTUpGFsQnvoNGimoon`.
Read-only pipeline runs against configured RPC/indexer, with the same shared 5 requests/s gate,
on 2026-10-09 at 16:45 UTC. They do not include public Cloudflare/browser queue latency.

| Observation               |       Quick |    Extended |
| ------------------------- | ----------: | ----------: |
| First findings            |      1.104s |      1.016s |
| Finished pipeline         |      3.736s |      7.667s |
| Indexed owners            |          15 |          15 |
| Sampled owners            |           2 |           3 |
| Distinct decoded receipts |           8 |          18 |
| Holder quality            |    complete |    complete |
| Distribution score        |      45/100 |      45/100 |
| Extended score            | unavailable | unavailable |

The largest indexed owner is a system-owned account, rather than a verified Pump vault. Its
observed share is 99.99%. This is concentration evidence, not proof of personal identity or fraud.
The external pool `CfmgmEM43QbFzLvsdgBgNj7ySnFJAy7oKrFdAvBazE3i` returned four real USD candles.
A wrapped-SOL control returned 100 candles. No supported on-chain Pump sell venue was established
for the user's mint; the sell scenario remains unavailable. Earlier 120s measurements used a much
larger observation scope. These timings compare different scopes and are not a universal SLA or
proof of equally complete analysis. No claim is made about the reference site's internals.

Ignored detailed evidence: `.local/verification/FAST_SCAN_LIVE.json` and
`FAST_SCAN_preview_REPORT.json` / `FAST_SCAN_deep_REPORT.json`.

## Verification and rollout

Typecheck, 170 unit tests, all 21 real PostgreSQL/Redis integration tests and 12 browser journeys
pass. Full production build succeeds; Vite still warns about the existing large main bundle and
the local NODE_ENV setting. Targeted tests cover large-balance stopping,
dispersed-holder ceilings, metadata-vs-transfer semantics, independent distribution eligibility,
external-chart discovery/mismatch and persistence without changing reserve models, plus the
default quick-scan and scoped score browser journey. Existing queue/cancellation/linking flows
remain part of the suites.

Telegram report formatting displays the same explicitly scoped distribution result separately
from extended unknowns. It is unit-verified; no live bot messages were sent.

The user must restart existing API/worker instances after build, push the local commit and
rebuild the Vercel frontend. Existing saved reports remain historical and are not rewritten;
run a new scan to get the new policy/fields. Full stage-13 operations and stage-14 acceptance
are still pending.

Primary references:

- https://solana.com/docs/tokens/extensions/metadata
- https://github.com/solana-program/token-2022/blob/main/interface/src/extension/mod.rs
- https://api.geckoterminal.com/docs/index.html

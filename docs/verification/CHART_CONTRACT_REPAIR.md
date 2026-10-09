# Available chart contract repair

Date: 2026-10-10, Asia/Novosibirsk.

## Reproduction and cause

The latest saved report concerned mint `E71f3Ph24bCiG2kGL1M3ywJV1yMTUpGFsQnvoNGimoon`.
GeckoTerminal returned HTTP 200 and four real candles for pool
`CfmgmEM43QbFzLvsdgBgNj7ySnFJAy7oKrFdAvBazE3i`. However, our API appended
`EXTERNAL_CHART_POOL_NOT_A_VERIFIED_SELL_MODEL` to the available chart's `reasons`.
The public contract requires available charts to have no unavailable reasons. Consequently,
the browser rejected the fresh response and the API rejected its own subsequent cache entry.
The generic catch misrepresented the cache validation error as provider unavailability.
An initial API restart temporarily returned a fresh response but did not fix either validation
failure. Real public-browser testing and safe phase logging identified the actual defect.

## Change

- Preserve unavailable reasons and their original strict status/candle consistency checks.
- Store the reviewed display-only pool qualification in a separate optional `qualifications` field.
  Existing frontend builds accept the otherwise unchanged chart response.
- Validate the final response before caching; discard invalid legacy cache entries and request
  real candles again within the existing deadline, gate and provider budget.
- Log failure phase, error type and reviewed provider code without error messages, URLs or secrets.
- Do not change scores, report snapshots, reserve verification or scan sampling.

## Actual verification

- `npm run typecheck`: pass.
- `npm test`: 171 tests in 30 files pass.
- Targeted `scans.test.ts -t chart` with real PostgreSQL/Redis: two tests pass; seven unrelated
  tests in that file were skipped. Covers real HTTP delivery, available external pool qualification,
  repeated cache reads, invalid legacy cache recovery and redacted failure diagnostics.
- `npm run build`: pass. Existing NODE_ENV and bundle-size warnings remain.
- Changed-file formatting and diff checks: pass.
- Restarted only the agent-managed API. Database containers, tunnel and existing workers remain.
- Public Chromium loaded saved report `f98a74ac-7281-45b3-965c-10b6606e1095` at
  `https://www.spidercrawl.fun/report/...`: the market request returned HTTP 200, four candles,
  empty unavailable reasons and no page errors. The actual chart canvas is visible.
- Repeated public API/cache read also returned the same four candles with the separate qualification.
- Screenshot retained locally at `.local/verification/PUBLIC_CHART_RESTORED.png`.

The last trading candle is old and the website correctly labels it stale. Four available candles
do not establish fresh trading activity, a supported sell model or universal provider availability.
No new scan or Telegram message was submitted. This checkpoint is local; no push or deployment.
Stages 13 and 14 remain pending in full.

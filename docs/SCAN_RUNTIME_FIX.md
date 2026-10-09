# Local scan runtime repair - 2026-10-09

The user re-enabled verification after reporting that scanning no longer worked.

## Reproduced failures and repair

- The development server listens on `127.0.0.1:5173`, while API CORS allowed only
  `localhost:5173`. Opening the numeric address blocked browser status/queue/report requests.
  Development now permits exactly the matching localhost, IPv4 and IPv6 loopback origins with
  the configured protocol and port. Production and remote origins are not broadened. The same
  policy is used by authentication/watchlist origin checks; CSRF/session checks remain in place.
- Opening a real token scan through localhost reproduced a `504 Outdated Optimize Dep` response
  when loading the lazy chart, followed by the root error boundary replacing the whole page.
  Vite now preoptimizes `lightweight-charts` before the scan route loads. A chart-local boundary
  keeps scanning and report access usable if a chart module later fails; only that section offers
  a page reload, not a manual initial chart-loading gate.
- A real preview demonstrated that collapsing the live scene at completion moved the results
  above the viewport. Arrival now runs at the live and saved-report milestones, once each. The
  final correction waits for the actual matching report ID; routine preview updates do not jump.
- Browser specs still used the former Russian copy, manual chart button and always-expanded
  details. They now exercise the English UI, open evidence/quality disclosures through the UI,
  and cover automatic charts, bounded arrival, absent pause buttons and chart-module failure.

## Verification

- Typecheck passed.
- 155 unit tests in 28 files passed, including development/production origin boundaries.
- 21 integration tests in six files passed against isolated infrastructure.
- 11 browser tests passed, including cancellation, SSE fallback, evidence and immutable links,
  exact candle values, Telegram linking against synthetic test endpoints, reduced motion and
  responsive containment at 320, 375, 414 and 768 pixels plus 200% zoom.
- Full production build passed. Frontend assets were rebuilt with normal configuration after
  browser testing so test-only API addresses do not remain in the serving bundle.
- Real browser preview submission through `127.0.0.1` created a saved partial report for the
  user's existing mint `E71f3Ph24bCiG2kGL1M3ywJV1yMTUpGFsQnvoNGimoon`, without page errors.
  A subsequent browser read verified results at 24 pixels from the top, one market panel and
  zero pause buttons. Screenshot: `.local/verification/scan-runtime-fixed.png` (ignored).
- Live API headers accept the two local browser addresses and omit CORS permission for a
  different port or an unrelated origin. PostgreSQL/Redis and configured worker are running.

The API alone was restarted to apply the origin fix. The Vite configuration change caused its
normal development reload; no worker or database was stopped, no Telegram messages were sent by
the diagnostic tools, and no push/deployment was performed.

## Remaining limits

The mainnet preview is partial: Token-2022 semantics need review and preview mode does not read
deep wallet histories. The chart endpoint returned `VERIFIED_POOL_UNAVAILABLE` for this mint,
so no candles can be claimed for it. The older deep job recorded a worker shutdown and saved a
partial report. These facts do not indicate a frontend failure, and no clean score or fabricated
chart is substituted. Stages 13 and 14, including wider mainnet acceptance, remain pending.

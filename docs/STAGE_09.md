# Stage 09 — functional website and evidence workbench

Implemented on `main`, 2026-10-09. No push or deployment. The user explicitly deferred styling,
spiders and the relationship map until `design.md` / `desigh.md`. This stage delivers functional
browser journeys; visual and live mainnet acceptance remain pending.

## Implemented surfaces

- `/`: mint/Pump/GMGN/Axiom form, preview/deep selection, actual provider configuration and
  dependency availability, bounded queue counts, recent immutable reports.
- `/token/:mint`: latest report or a specific scan via `?job=<uuid>`, durable live progress,
  preview, final result and cancellation available only to the originating browser session.
- `/report/:id`: historical report, observation times, rule/parser versions, slots, qualification,
  permanent link, clipboard sharing with fallback and complete JSON export. Intermediate previews
  do not expose a nonexistent immutable report URL.
- Reports include risk/data completeness, eligibility reasons, concentration and denominators,
  paginated searchable owner balances, token-account detail, wallet history, early buyers,
  position changes, sell scenarios and routes, relationship/control-hypothesis tables and evidence.
- Evidence opens in a native modal with source, time, slot, commitment, rule/parser version,
  confidence, interaction/hypothesis distinction and transaction links. Escape and keyboard focus
  return work; confirmed interactions never become proven personal identity.
- `/methodology`: actual heuristic semantics, unknown data, window coverage, denominator,
  comparison requirements and scenario limitations.
- `/status`: live infrastructure/queue reads and capability flags. Configured providers are
  explicitly distinguished from a successful external read.
- `/watchlist`: truthful pending feature explanation. Verified identity, shared persistent watches
  and settings belong to stage 11; this stage does not invent local-only persistent monitoring.

React Router/Query use the shared validated contracts. Navigation, deep links and reloads work
against the same API. Static production hosting must fall back to `index.html` for these routes;
reverse-proxy/release configuration belongs to stage 13.

## Progress, precision and containment

SSE resumes from monotonic event IDs. HTTP polling continues if the stream fails; failed status
requests back off to 30 seconds. Abort controllers prevent a superseded route from rendering an
old response. Terminal jobs close their stream and clear cancellation capabilities. Capabilities
are stored only in `sessionStorage`, never query parameters, share links or the public report.
Restricted browser storage leaves the scan running but cannot persist cancellation across reloads.

Stale report/holder/market timestamps are qualified after two minutes, with original timestamps
retained. Public report bodies are never changed to hide age or missing evidence. Raw u64 balances
and signed differences format through strings; chart approximation never enters token arithmetic.
Tables render only 25 rows per page, and overflow inside keyboard-accessible table regions. Native
controls, wrapping, skip link, focus outline and containment are the only CSS in this stage. There
is no decorative motion, brand visual or design acceptance claim.

## Independent market chart

`GET /v1/tokens/:mint/market` selects a PumpSwap pool present in a persisted, chain-derived report.
No user-supplied URL or arbitrary pool can trigger a provider fetch. A fixed GeckoTerminal HTTPS
endpoint requests 100 five-minute USD candles with explicit token-address selection; metadata
must include that mint. Redirects, malformed/duplicate candle times, impossible ranges, oversized
bodies, float underflow and interrupted streams fail closed. The request has a deadline, a
cross-process Redis gate (one request per six seconds), the shared daily provider budget and a
60-second pool/mint cache. Busy/down/empty/unsupported becomes unavailable, never zero prices.
Enrichment makes one bounded attempt; it does not retry indefinitely or change immutable risk or
scenario data. Curve-only tokens currently have no supported OHLCV source.

The chart is requested by a button and lazy-loaded. Lightweight Charts retains its attribution,
source/time/pool links and exact provider decimal strings in an accessible OHLCV table. Gaps are
not filled with fabricated candles. Current enrichment on a historical page is explicitly separate
from the report snapshot. Axiom outbound links prefer the verified canonical PumpSwap pool when
one was discovered; live destination behavior remains an acceptance item.

Official provider contract consulted on 2026-10-09:
[GeckoTerminal API documentation](https://api.geckoterminal.com/docs/index.html),
[published OpenAPI contract](https://api.geckoterminal.com/docs/v2/swagger.json).
This is documentation verification, not a successful mainnet chart capture.

## Verification and local preview

Run the normal site against local services, with external credentials in the ignored root `.env`:

```sh
npm run infra:up
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run dev:web
```

Run those three development processes in separate terminals. Open `http://localhost:5173`.
The current local configuration has no RPC/indexer/Telegram credentials; the site honestly disables
new scans until these are configured. Existing reports remain readable. No secrets use a `VITE_`
prefix. The only frontend variable is the public API origin; Vite must restart after changing it.

Verified checks:

- `npm run check`: strict typecheck, 142 unit tests, service/static production builds and formatting.
- `npm run test:integration`: 11 real PostgreSQL/Redis tests, including independently timed chart
  enrichment, concurrent provider gate, validated cache and immutable report retention.
- `npm run test:browser`: 8 Chromium journeys against the built website, real API/DB/Redis/runner
  and an explicitly synthetic, injected test pipeline. Pump/GMGN and Axiom pool-to-mint input,
  preview/reload/final report, evidence/keyboard focus, terminal links, export, cancellation,
  SSE failure with polling, partial/failure/missing/degraded/stale states and independent candles
  are covered. 320/375/414/768 px, reduced motion and 200% CSS layout zoom have no document overflow.
- Local synthetic screenshots: `.local/verification/stage09-desktop.png` and
  `.local/verification/stage09-mobile.png`. Test reports visibly state `SYNTHETIC_TEST_FIXTURE`.
- `npm run doctor:services`: real local infrastructure healthy; provider/Telegram keys pending.
- `node tools/foundation-smoke.mjs`: compiled API/worker and built frontend start successfully.

Browser fixtures and loopback synthetic RPC/cleanup endpoints live exclusively in `tests/browser`;
no production entrypoint imports them. The harness uses an isolated disposable schema and Redis
queue prefix. Explicit teardown also cleans these on Windows. Browser builds temporarily use a
test API origin; rebuild with `npm run build` before using the normal production artifacts.
CI installs Chromium and runs these journeys with the same local infrastructure services.

Pending: mainnet scan/chart and actual terminal destination checks, provider capacity measurement,
the supplied design and spider/map visual, Telegram stage 10, watchlists stage 11 and release gates
12–14. This checkpoint is not a fully released product. Stop after this local stage commit.

# Architecture decisions — 2026-10-09

## Scope and product identity

CrawlSpider is the working project name, taken from this workspace. Final branding can be changed
without changing the implementation. The primary users are Solana traders researching holder
concentration and monitoring changes. The project is a read-only analytics product.

The user confirmed Axiom/GMGN integration means analysis plus links to those terminals. No browser
extension is in the required build. Axiom and GMGN are interfaces, not additional blockchains or
separate token universes. Both clients must resolve to the same canonical Solana mint and report.
Axiom URLs may refer to pools, so a base58 substring must not automatically be treated as a mint.

Own-token issuance, burns, rewards, referral commissions and trading execution are not included:
they are separate businesses/features, not prerequisites for the requested scanner.

## Stack

- TypeScript across the product: shared report schemas, less client/server drift.
- Node 24 LTS family for API, bot and worker; verify the latest supported security patch before release.
- React 19, Vite, TanStack Router/Query for the static website. CSS tokens and component styles,
  rather than runtime-generated HTML or string-replacement page builds.
- Fastify for HTTP API, validation, rate limiting and SSE. HTTP acceptance is independent of scan work.
- BullMQ + Redis for bounded queues, retry schedules and monitoring. PostgreSQL remains the canonical
  job/report/event/outbox store; reconcile Redis against accepted database jobs after failures.
- PostgreSQL 17, Drizzle migrations, integer strings/numeric columns for token amounts.
- grammY for Telegram long polling in local development and verified webhook handling in production.
- Solana Kit 8.4.0 and current generated Token/Token-2022 packages for RPC/account codecs.
  Official Pump protocol IDLs are extracted unchanged from Pump SDK 4.0.0 / PumpSwap SDK 2.1.0,
  attributed and hash-pinned. Runtime SDKs are deliberately excluded: their legacy web3/Anchor
  trees introduced high-severity transitive audit findings during preparation.
- Decimal.js for decimal math, bigint for amounts, lossless JSON where a provider returns large JSON numbers.
- Lightweight Charts for candles and React Flow for an inspectable relationship map. Animated spiders
  use a separate lightweight layer driven by server events; table/evidence views remain accessible.
- Vitest, Playwright, ESLint, Prettier and autocannon for appropriate verification.
- Prometheus client: maintained `@prometheus-io/client`, rather than deprecated `prom-client`.
- Narrow overrides replace vulnerable transitive esbuild and uuid versions. Keep dependency
  compatibility checks; do not apply blind major downgrades suggested by npm audit.

No AI/LLM is needed to compute a verdict. It would add cost, latency and nondeterminism without
fixing the missing-data problem. Optional generated mascot artwork is a design asset only.

## Providers and correctness boundaries

1. Helius indexed token-account pagination is the planned full-holder source. Credentials and actual
   account plan capabilities are validated before claiming complete mainnet analysis.
2. Configured Solana RPC verifies mint/program/account data and transactions; a second RPC is a
   failover option, not a substitute for indexed holder enumeration.
3. If no capable indexer exists, an RPC top-20 result is explicitly a limited preview. It cannot
   silently satisfy the full analysis acceptance gate.
4. GeckoTerminal and DexScreener enrich prices/charts. Missing market enrichment never changes an
   unknown reserve into zero liquidity or grants a clean verdict.
5. GMGN API is optional enrichment requiring separate access. User requested terminal links, so
   product correctness cannot depend on GMGN's private endpoints or undocumented Axiom APIs.
6. No arbitrary URL fetching for pasted links; resolve supported URLs locally or through fixed
   allowlisted provider adapters. Mint/pool identity is verified against chain accounts.

## Runtime and persistence

The static frontend can be served by a CDN/Sites or bundled reverse proxy. Public API and background
services need a Node runtime and persistent PostgreSQL/Redis. Do not attempt to host the scan queue
or database in a 128 MB edge isolate. This preparation is local-only; no Site registration, remote
push or deployment is authorized as part of the current workflow.

Docker Compose supplies local databases, and later supplies all production processes behind TLS.
Local queues/caches, database credentials, RPC secrets and bot tokens are ignored by Git. Database
ports are loopback-only. Production uses separate secrets and explicitly sized service limits.

## Public beta topology (user selection, 2026-10-09)

The user selected Vercel for the static website only. Fastify API, BullMQ worker, PostgreSQL and
Redis remain on the user's Windows PC. A named Cloudflare HTTPS tunnel publishes the loopback API;
databases remain private. Optional Telegram runs locally in polling mode. This replaces the
uncommitted web+API Vercel candidate, without changing durable analysis/persistence semantics.

The repository-root Vercel Services configuration explicitly defines one public service `web`
on `/(.*)`. Browser fetch/SSE use build-time `VITE_API_URL`, pointing at `https://api.<domain>`.
There are no internal Vercel services or caller-side bindings. The actual API paths stay `/v1/...`.
Use HTTPS frontend/API hostnames on the same registrable domain to retain current SameSite=Lax
session behavior. Only opt-in, immediate-loopback proxy trust is permitted for visitor quotas.
Configuration and instructions are local preparation, not proof of a cloud/tunnel deployment.
The PC must stay on; stage 13 full operations and stage 14 public/live acceptance remain pending.

## Result semantics

2026-10-09 user-requested latency repair: the website defaults to a quick targeted recent-history
sample (six owners, 6s history budget), with an optional extended sample (twelve owners, 20s).
The indexed holder table is not trimmed. Coverage limitations remain explicit. A separately
versioned snapshot distribution score is allowed when the holder/authority/flag gates pass,
without requiring full history or a sell venue; it cannot replace the extended token assessment.
External provider pool discovery is chart-only and never changes on-chain reserve eligibility.

- First result: a bounded preview that can say pending/partial.
- Deep result: evidence-backed report with its own completion state and coverage.
- `riskScore` and `confidence` are separate; publish exact direction/meaning of the score.
  User-facing wording is "distribution risk", not a probability of fraud.
- Direct interaction evidence is not identity evidence. Behavioral edges must not turn an entire
  mixed cluster into a proven operator.
- Scenarios estimate price impact under explicit venue/routing/fee assumptions. They do not predict
  whether or when holders sell.
- Unknown unsupported pool math is visibly unavailable. Do not apply constant-product math to
  concentrated liquidity or DLMM reserves.
- Calibration starts with forward-collected history and versioned heuristic rules. A working launch
  can use transparently labelled heuristics; predictive accuracy requires sufficient held-out outcomes
  and must not be fabricated at release.

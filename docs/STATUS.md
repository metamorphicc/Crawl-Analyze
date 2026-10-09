# Implementation status

Updated: 2026-10-09, Asia/Novosibirsk.

## Current stage

**Stage 05: implemented and locally verified; live history acceptance pending credentials.**

Stage 04 checkpoint: `5dcb6e4`. Stage 05 subject:
`feat: trace wallet relationships with evidence and confidence`.
77 unit tests, typecheck and full build pass. Bounded retained-window wallet/token-account history,
transaction reuse, causal funding traces, >20-owner supply-based selection, targeted counterparties,
reviewed-label/hub exclusions, transaction-linked evidence and corroborated control hypotheses are
implemented. Shared contract graph schemas and a real-adapter developer command are available.
See `docs/STAGE_05.md`. Unknown archive/entry data cannot imply a fresh or clean wallet.

Stage 03 checkpoint: `08cae90`. Stage 04 subject:
`feat: decode Pump trades and token flows across migrations`.
63 unit tests, strict typecheck and full workspace/web build pass. IDL tuple/version decoding,
signed reserves, CPI/ALT flows, missing owner/receipt safeguards and verified market state are
implemented. See `docs/STAGE_04.md` and `docs/VENUE_CAPABILITIES.md`. No live corpus result claimed.
The user's current scope is stages 04–06 only, then stop; do not begin stage 07.

Current branch: `main`. Stage 00 is committed as `35d63d6`; workflow steering as `1e505f2`.
Stage 01 checkpoint: `4e3ee68`.
Stage 02 subject: `feat: resolve Solana mint and terminal links safely`.
Stage 02 checkpoint: `39daccc`. Stage 03 subject:
`feat: index holders with snapshot quality and provider failover`.

Stage 03 delivers full bounded DAS pagination, owner aggregation, strict u64 amounts, supply and
index-slot reconciliation, partial states, bounded reread, individually verified Pump/PumpSwap vault
exclusions, durable cross-process request/rate budgets, bounded retry/failover/circuit cooldown and
response/body cancellation limits. Missing account flags remain null. See `docs/STAGE_03.md`.
43 unit tests, 3 real-infrastructure integration tests and builds pass. Live >20-owner reconciliation,
real DAS capability and mainnet vault evidence remain pending. Request caps are not a dollar credit
cap; an actual tariff model remains an operational configuration item.

Stage 02 adds canonical bare mint/Pump/GMGN/Axiom parsing, referral stripping, hostile hostname/
wrong-chain/ambiguous input rejection, lossless RPC JSON, cancellable RPC requests and configured
fallback, SPL mint authority/decimals/supply verification, Token-2022 extension discovery,
PumpSwap pool-to-base-mint resolution, safe terminal links, `/v1/resolve` and an unstyled token form.
31 unit tests and full strict build pass. Official landing routes were read, but Axiom's destination
was inaccessible to the browsing tool; actual terminal token/pool navigation remains pending.
`tools/live-check.ts` reports the absent local RPC/indexer configuration; no mainnet success claimed.
Unsupported Axiom pool venues require the mint rather than silently choosing another token.

Stage 01 delivers strict workspace builds, versioned request/job/event/evidence/mint/quality contracts,
safe validated configuration, API live/readiness/status routes, independent service entrypoints,
an unstyled frontend status page, transactional idempotent migration, PostgreSQL durable job/report/
identity/watch/outbox/outcome tables, redacted logging, bounded readiness checks and CI.

Verified: 7 unit tests, 2 real-infrastructure integration tests, empty-schema migration/reapplication,
active-job uniqueness, real PG/Redis readiness, full builds and compiled-process/browser smoke.
Telegram polling requires the user's token and is not live-verified; no bot message has been sent.
Worker infrastructure starts but scan processing is intentionally installed in subsequent stages.

Commit subject: `chore: bootstrap toolchain and full product build plan`.
The commit containing this document is the stage-00 checkpoint. The agent never pushes.

## Delivered

- Exact npm workspace dependencies and reproducible lockfile for site, API, worker, bot and shared packages.
- Node/TypeScript tools, React/Vite, Fastify, BullMQ/Redis, PostgreSQL/Drizzle, grammY,
  Solana Kit/Token codecs, chart/graph libraries, fonts and verification tooling.
- Official Pump/PumpSwap/fee IDLs with source attribution, original byte hashes and integrity check.
- Docker Desktop Linux engine running and two isolated healthy local containers.
- Playwright Chromium + headless shell/FFmpeg installed; real headless browser launch verified.
- Ignored local `.env`, generated local-only database password, configuration examples and diagnostics.
- Full build plan, architecture decisions, provider research and persistent agent instructions.
- Local reference checkout excluded from Git; no copied reference application or embedded repository.

## Verified preparation gates

| Check                               | Result                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts --no-fund` | Reproducible installation from final lockfile                                     |
| `npm rebuild esbuild`               | Required compiler binaries rebuilt successfully                                   |
| `npm run toolchain:check`           | Strict TS and real library/API compatibility passed                               |
| `npm run browser:check`             | Chromium 156.0.8078.4 launched and rendered an environment-only document          |
| `npm run doctor:services`           | Docker, healthy containers, PostgreSQL query and Redis ping passed                |
| `npm audit --audit-level=moderate`  | 0 known vulnerabilities in final dependency tree                                  |
| `npm run format:check`              | Formatting checked before stage commit                                            |
| `git diff --check`                  | Whitespace checked before stage commit                                            |
| Staged file review                  | No local credentials, reference checkout, runtime files or dependency directories |

Prepared runtime versions: Node 24.11.1, npm 11.3.0, TypeScript 6.0.3, React 19.3.0,
Vite 8.3.4, Fastify 5.12.5, Solana Kit 8.4.0, Playwright 1.64.0, Docker engine 29.0.1,
PostgreSQL 17.11 and Redis 8.10.2. All npm package versions are in the manifests/lockfile;
the actual container references/digests are in `docs/ENVIRONMENT.md`.

## Resolved environment issues

- Docker Hub returned 403; project containers use pinned public Amazon ECR mirror references locally.
- Latest TypeScript 7 was incompatible with typescript-eslint's peer range. Pinned supported 6.0.3,
  matched Node type definitions to the Node 24 runtime, and did not suppress peer checks.
- Initial official Pump SDK dependency tree had high-severity audit findings. Removed runtime SDKs
  and legacy web3/Anchor packages; retain only attributed protocol IDLs and use current Solana Kit.
- Narrow overrides patch transitive uuid and legacy development esbuild. The migration CLI and
  toolchain import paths are checked; full schema migration tests occur in stage 01.
- Reinstallation of the migration CLI corrected npm's stale nested esbuild resolution. Final
  dependency audit and clean installation verify the resulting lockfile.

## What is pending (not a stage-00 blocker)

- The user confirmed provider/Telegram accounts exist, but external credentials have not been filled
  into this repository's ignored `.env`. Diagnostics list only configured/pending, never values.
- No mainnet provider call, real scan, terminal URL resolution or Telegram message has been tested.
- Website design remains deferred. The service foundation exists; analytical scan execution and
  complete user journeys are implemented in subsequent stages.
- No remote is configured in this new repository, no commit is pushed, and nothing is deployed.
- Forward outcome data and predictive validation require real observations after the data pipeline
  exists. The plan explicitly separates heuristic release from empirically validated accuracy.

## Next task

Implement **stage 06** scoring and liquidity scenarios, then stop after its local commit.
Continue independently
of the pending live gates; do not mark those gates passed without credentials and evidence.

Continue directly on `main`, as explicitly requested by the human. No push.
Website styling and spider animation wait for the user's `design.md` / `desigh.md`.

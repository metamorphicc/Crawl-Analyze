# Implementation status

Updated: 2026-10-09, Asia/Novosibirsk.

## Current stage

**Stage 01: implemented and locally verified — runnable services and shared contracts.**

Current branch: `main`. Stage 00 is committed as `35d63d6`; workflow steering as `1e505f2`.
Stage 01 checkpoint subject: `feat: add shared contracts and runnable application services`.

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

Implement **stage 02**: canonical mint/link input, mint verification, safe terminal links and a
resolution API. Live validation remains pending local provider credentials.

Continue directly on `main`, as explicitly requested by the human. No push.
Website styling and spider animation wait for the user's `design.md` / `desigh.md`.

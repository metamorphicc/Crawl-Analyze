# CrawlSpider

Solana token intelligence: holder relationships, concentration, liquidity scenarios, early buyers,
and change alerts through a website and Telegram bot. Accepts Solana mint addresses and supported
pump.fun, Axiom and GMGN links.

**Current state: functional website through stage 09, locally verified.** Supported inputs,
holder indexing, Pump decoding, wallet evidence, heuristic risk, scenarios, durable scans and
position comparisons are implemented. The [website](docs/STAGE_09.md) supports scan/progress/report/
evidence/export/terminal journeys. [Early buyers and changes](docs/STAGE_08.md) and
[queue/API recovery](docs/STAGE_07.md) use the same immutable reports. Telegram interaction and
persistent watchlists are stages 10–11. Mainnet acceptance still needs local provider keys;
website styling and spiders await the user's `design.md`.

- [Complete build plan](docs/BUILD_PLAN.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Current status and next task](docs/STATUS.md)
- [Verified provider research](docs/SOURCES.md)
- [Environment setup](docs/ENVIRONMENT.md)

## Local prerequisites

Node 24 (prepared runtime: 24.11.1), npm 11, Docker Desktop with Linux containers.

```sh
npm ci
node tools/setup-local.mjs
npm run infra:up
npm run db:migrate
npm run doctor:services
npm run check
```

`setup-local.mjs` creates `.env` once with a random local database password and never overwrites an
existing file. Fill external provider and Telegram credentials only in the ignored `.env` file.
Each service validates its configuration. The bot requires a real token before it starts polling.
No key values are included in health responses or logs.

Run processes in separate terminals from the repository root:

```sh
npm run dev:api
npm run dev:worker
npm run dev:web
npm run dev:bot
```

Open `http://localhost:5173`; API is `http://localhost:3001`. Liveness is `/health/live`, dependency
readiness is `/health/ready`. `/v1/status` additionally exposes provider capabilities as booleans.
`npm run build` compiles packages/services and the Vite frontend. Compiled API/worker/bot can run
with `node apps/<service>/dist/index.js` from the repository root. Schema migration is idempotent.
`npm run test:integration` uses real local PostgreSQL/Redis and an isolated disposable test schema.
`npm run test:browser` builds the site and runs Chromium against an isolated real API/DB/queue with
explicitly synthetic test reports. It does not contact mainnet or Telegram. Rebuild afterwards for
the normal API origin. Historical browser routes require an `index.html` fallback when hosted.

The local PostgreSQL and Redis containers bind to `127.0.0.1` only and retain named volumes.
`npm run infra:down` stops them without deleting those volumes.

## Repository structure

```text
apps/web/             React/Vite static frontend
apps/api/             Fastify public API and event streams
apps/worker/          Durable scan and monitoring jobs
apps/bot/             Telegram bot
packages/contracts/   Shared schemas and API/event contracts
packages/config/      Typed validated configuration
packages/providers/   Solana, indexer and market-data adapters
packages/analysis/    Evidence, clustering, scoring and price-impact math
packages/storage/     PostgreSQL schema and Redis adapters
tools/                Development environment and compatibility checks
docs/                 Build plan, decisions, status and verification
```

Application source is added stage by stage. The reference CrawlScan checkout is local-only and
excluded from this repository.

## Git workflow

Every completed stage receives a local commit. **The agent does not push or deploy.**
Work takes place directly on `main`, as requested by the user.

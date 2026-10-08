# CrawlSpider

Solana token intelligence: holder relationships, concentration, liquidity scenarios, early buyers,
and change alerts through a website and Telegram bot. Accepts Solana mint addresses and supported
pump.fun, Axiom and GMGN links.

**Current state: stage 00 — development environment and implementation plan.** The scanner,
website and Telegram bot are planned; they are not implemented yet.

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
npm run doctor:services
npm run check
```

`setup-local.mjs` creates `.env` once with a random local database password and never overwrites an
existing file. Fill external provider and Telegram credentials only in the ignored `.env` file.
The application will not use the external accounts until a later live integration stage.

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

The workspace package manifests currently install components; application source is added stage
by stage. The reference CrawlScan checkout is local-only and excluded from this repository.

## Git workflow

Every completed stage receives a local commit. **The agent does not push or deploy.**

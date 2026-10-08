# Local environment

This stage installs development components, not the finished app. It does not connect a real
Telegram account or start a mainnet scanner. The user has external accounts; their credentials
are configured only in the ignored root `.env` before live integration.

## Reproduce

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npx playwright install chromium
node tools/setup-local.mjs
npm run infra:up
npm run doctor:services
npm run check
```

Initial dependency resolution is recorded in the exact workspace package manifests and lockfile.
TypeScript is pinned to 6.0.3 because the installed typescript-eslint peer range excludes 7.x.
Do not use `--force`/`--legacy-peer-deps` to conceal incompatibility.

The final provider stack uses Solana Kit and hash-pinned official protocol IDLs, rather than
installing the legacy Pump SDK/web3/Anchor dependency tree. Development-only esbuild and uuid
dependencies have narrow compatibility overrides to patched versions. Audit findings and final
verification are recorded in `docs/STATUS.md`.

Node 24.11.1/npm 11.3.0 were already installed. Docker Desktop is installed and its Linux engine
was started for this project. PostgreSQL/Redis are project-specific containers and named volumes.
Only the required Chromium browser is installed for browser QA; Firefox/WebKit are not needed
for this product's current target.

## Docker registry fallback

Docker Hub returned HTTP 403 in this environment. Official image families were successfully
retrieved from the public Amazon ECR mirror. The local `.env` overrides the image references;
normal Docker Hub defaults remain in `.env.example` for other environments.

```dotenv
POSTGRES_IMAGE=public.ecr.aws/docker/library/postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
REDIS_IMAGE=public.ecr.aws/docker/library/redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0
```

Do not dump Docker Compose's resolved environment into chat/logs: it contains the database password.
Use `docker compose config --quiet`, health inspection, and `npm run doctor:services` instead.

## External configuration

Set `HELIUS_API_KEY`, `SOLANA_RPC_URL` and `TELEGRAM_BOT_TOKEN` locally. A second
`SOLANA_FALLBACK_RPC_URL` is useful for failover. Do not use a public demo endpoint as a production
full-holder indexer. Stage 02/03 checks provider plan access and capabilities without revealing keys.
If the chosen provider is not Helius, implement/validate the equivalent holder enumeration adapter
before marking deep holder coverage complete.

No bot message is sent as part of environment setup. Real bot interaction is verified later
through an explicitly user-triggered command.

## Developer commands

| Command                   | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `npm run doctor`          | Runtime, lockfile and local configuration status; secret values hidden |
| `npm run doctor:services` | Also validates containers, PostgreSQL query and Redis ping             |
| `npm run toolchain:check` | Strict TS check and actual SDK/API/tool imports                        |
| `npm run format:check`    | Repository formatting                                                  |
| `npm run check`           | Preparation-stage verification; not product tests                      |
| `npm run infra:up`        | Start local databases and wait for health                              |
| `npm run infra:down`      | Stop project containers while retaining named volumes                  |

Application dev/build/test scripts are introduced in stage 01 alongside real source. Their absence
at this stage is intentional and is not hidden by scripts that pass without running product tests.

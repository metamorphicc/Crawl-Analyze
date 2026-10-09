# Hybrid hosting configuration verification

2026-10-09, Asia/Novosibirsk. Scope: static website on Vercel, public HTTPS tunnel to the user's
Windows PC API, local worker/DB/Redis. No deployment, tunnel publication or credentials changes.

## Verification

- `npm run typecheck`: pass.
- `npm test`: 29 files, 163 tests pass. Includes production CORS/preflight, opt-in proxy trust,
  spoofed extra forwarded hops, direct/nonlocal peers and external browser API URL selection.
- `npm run test:browser`: full build and all 11 journeys pass, including durable scans/reload,
  SSE fallback, result arrival/charts and linked watchlists. Uses isolated test DB/queues and
  synthetic reports, not a mainnet or Telegram claim.
- Vercel CLI 63.1.0 `vercel dev -L`: only `web` detected. Homepage, methodology, status, watchlist,
  token and report paths return HTML; their script URLs return JavaScript. The initial universal
  SPA rewrite returned HTML for Vite virtual scripts; replaced it with actual client-page rules.
- `node ../../tools/build-service.mjs web`, run from `apps/web` with `VERCEL=1` and an explicit
  test HTTPS API origin: pass. Contracts and frontend build without backend runtime or DB access.
- Eight public build settings rejected before compilation: missing/empty, HTTP, localhost,
  loopback IP, `/v1` path, URL credentials, query. Errors identify the setting without its value.
- Inspect generated JS/HTML/CSS: configured test origin present; no matching known local
  DB/Redis/password/provider/bot/webhook credential values; no generated source maps. This is
  a bounded check, not proof that every possible secret is absent.
- `npm audit --omit=dev`: zero production vulnerabilities returned by the registry.
- Normal full build restores the local frontend's existing API configuration after hosting and
  browser tests. Formatting and `git diff --check` are required before commit.

On this agent's Windows host, Vercel CLI inherited duplicate case-variant PATH variables and
failed to spawn the shell. An ignored local wrapper normalized child PATH/ComSpec and loaded
the ignored environment quietly for the CLI check. It did not change tracked application
configuration or expose environment values. Vercel CLI/state/check scripts remain ignored.

## Scoped security review

Applied [security-launch-audit](C:/Users/User/.codex/skills/security-launch-audit/SKILL.md).
**Security decision: Pass for the revised hosting configuration within this local scope.**
Residual configuration risk: low; full public product/release audit is still stage 13 work.

Threat model: anonymous scans consume provider budget; linked watchlists use private sessions;
Vercel hosts public browser assets; the tunnel crosses the internet-to-local-API boundary.
Provider/bot/database secrets must remain on the PC. Trading/signing/payments/uploads are absent.

Confirmed finding, fixed:

- **Medium, OWASP A05: tunneled visitors share one quota identity.** Previous API `trustProxy:false`
  used the connector's loopback address in the scan quota bucket (`apps/api/src/scans.ts`) and
  Fastify's limiter. Added explicit, immediate-loopback-only trust, default off, with listener
  validation. Tests show the nearest nontrusted visitor is used, older spoofed hops and headers
  from direct remote peers are not trusted. Deployment must keep API inaccessible except through
  the trusted connector/local machine; local processes are inside this trust boundary.

Reviewed unchanged boundaries: hashed expiring sessions/link capabilities, server-derived user
IDs and parameterized owner-scoped SQL; exact origin/CSRF checks on authenticated mutations;
bounded JSON bodies/SSE counts; typed input and allowlisted token links rather than arbitrary
URL fetching; React rendering without raw HTML injection in searched source; logger redaction;
constant-time bounded Telegram webhook-secret checking (chosen polling mode needs no webhook).
No additional exploit finding is inferred from these reads. Known local secrets/artifacts and
production dependencies were checked as above. Full dependency/dev tooling audit, sustained abuse
testing, backups/restore, process supervision and real provider/public deployment remain outside
this substage.

Next: user pushes the local commit, configures real domain + named tunnel + public VITE_API_URL,
starts backend processes and verifies browser CORS/SSE/cookies against the actual HTTPS hosts.
Independent `vercel.app`/`trycloudflare.com` sites are not accepted for current SameSite=Lax
authenticated journeys. No public availability claim is made before that verification.

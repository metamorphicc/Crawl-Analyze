# CrawlSpider — complete product build plan

Date: 2026-10-09. Owner: implementation agent in this repository. This file is the execution plan
for the entire user-facing product, not a claim that those features already exist.

## 1. Required product

An original Solana token intelligence product with a usable website and Telegram bot. A user
pastes a mint address or pump.fun/Axiom/GMGN link, gets a transparent analysis of supply control,
opens the token in a terminal, and watches meaningful changes. Site and bot use the same analysis,
history, subscriptions and rule versions.

Required analytical capabilities:

- Exact/qualified holder counts and owner aggregation across token accounts.
- Infrastructure exclusions verified from account/program/pool evidence.
- Trades versus distributions, previous trading history, launch entries and early buyers.
- Direct transfers, shared distributors, bounded funding traces and behavioral coordination.
- Evidence-based relationship groups and confidence, including known hub/service exclusions.
- Supply concentration, configurable deep coverage and detection of fragmentation below the top 20.
- Venue-aware sell scenarios, reserves, fees, quote currency and data freshness.
- Versioned scoring, explicit partial/unknown states and forward outcome tracking.
- Durable monitoring, actual position changes and Telegram notifications.

Scope confirmed by user: Axiom/GMGN support is analysis and terminal links. No extension or in-app
trade execution. Provider and Telegram accounts already exist; credentials remain local.
The original project's own-token rewards/burns are not a required scanner feature.

## 2. User journeys and usable surfaces

### Website

- `/`: immediately usable input, supported-link examples, recent verified scans, queue/provider state.
  No marketing hero that makes users scroll to reach the scanner.
- `/token/:mint`: live preview/deep analysis, token stats, data-quality indicator, chart, scenario,
  relationship map, searchable holder table, early buyers, evidence drawer, watch button and terminal links.
- `/report/:id`: immutable historical report with analysis time, slot, coverage and rule/parser versions.
- `/watchlist`: persistent watched tokens and notification settings, linked through verified Telegram identity.
- `/methodology`: rule definitions, score direction, limitations, scenario assumptions and calibration status.
- `/status`: truthful service health and incident/degraded state, with no secret configuration exposure.

Public scanning needs no wallet connection and no login. Telegram identity links personal
watchlists; browsing reports remains public. Mobile offers table/evidence as a first-class
alternative to graph navigation.

### Telegram bot

- Direct mint/link message and `/scan` start the same server job as the website.
- `/start`, `/help`, `/watch`, `/watchlist`, `/unwatch`, `/settings`, `/status` have useful responses.
- Groups accept explicit `/scan` commands and do not interpret unrelated messages as requests.
- Acknowledgement is immediate; one message is edited as preview/deep status progresses.
- Final message includes risk, confidence, coverage, concentration, scenario and report/terminal links.
- Callback watch/unwatch and preferences enforce the sender's identity.
- Notifications batch changes, respect per-chat cadence/quiet hours and survive restarts.
- Users can unlink their identity and delete their subscriptions/preferences.

## 3. Visual direction

**User clarification, 2026-10-09:** a minimal usable UI is required now. The final visual
implementation waits for the user's `design.md` / `desigh.md`.
The ideas below describe the final design, which remains a proposal pending that document.
Basic styling and an English website interface are authorized now. Stages 13–14 remain paused
at the user's request. All stage commits are made directly on `main`, never pushed.

Working name: CrawlSpider. A dark investigative workbench with a large relationship map beside
compact live findings. Typography uses Space Grotesk and IBM Plex Mono; final palette tokens are
chosen in the UI stage through Hallmark rather than copied from CrawlScan.

Signature: small mechanical spiders crawl wallet nodes. Verified interactions become taut web
threads; behavioral hypotheses are visibly different and never look equally certain. Clicking a
thread opens the underlying transactions. When a cluster is selected, its balance and potential
sell scenario are highlighted together. Spiders stop when a report completes.

The visual is driven by actual stage/evidence events, not a timer pretending to perform analysis.
It cannot obscure addresses, delay results, intercept input or fabricate evidence. Make the map
keyboard-accessible through its equivalent table, provide pause/reduced-motion mode, cap visible
nodes, and keep mobile usable at 320/375/414/768 px. No expensive decoration before useful data.

## 4. Architecture and canonical data flow

```text
Website / Telegram
       -> URL/address normalization and mint verification
       -> API quota + deduplication + database job/outbox
       -> bounded BullMQ queues (interactive, deep, monitoring)
       -> workers / provider budgets / cancellable requests
       -> holder index + RPC verification + transaction decoders
       -> normalized evidence / graph / concentration / scenarios
       -> versioned risk report + quality and coverage
       -> PostgreSQL reports + append-only events
       -> SSE / Telegram result updates / notification outbox
```

Data tables planned: token identity, pool registry, holder snapshots, wallet balances, transaction
evidence, decoded swaps/transfers, relationship edges, report versions, scan jobs/events, provider
costs, watch subscriptions, verified Telegram identities, notification outbox and token outcomes.

Store raw amounts as integer strings/numeric, not float. Every relevant row retains slot,
commitment, observation time, provider, decoder version and completeness. Cache keys include chain,
mint, slot/window and relevant parser/rule version. No mutable report replacing an old public URL.

Database jobs/events are authoritative; Redis is replaceable queue/cache infrastructure. An
accepted database job must be recoverable after Redis interruption. The notification outbox
uses durable state and stable idempotency keys; Telegram's send API cannot promise exactly-once
delivery after an ambiguous network response, so bound and track possible duplicates honestly.

## 5. Closing the reference project's weaknesses

| Reference limitation                           | Required correction                                                                                   | Evidence of completion                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Top 20 presented as holder picture             | Enumerate indexed token accounts, aggregate owners, then choose history coverage by supply share/rank | Paginated fixtures and mainnet reconciliation with slot/coverage metadata |
| Token accounts confused with participants      | Canonical owners; consolidate multiple accounts; expose inferred group count separately               | Fixtures for many accounts per owner and service custody                  |
| Links treated as proof of common owner         | Separate interaction evidence, control inference and behavioral hypotheses                            | No soft edge upgrading an entire mixed component to proven ownership      |
| Funding disabled                               | Trace bounded funding paths, label known services and exclude fanout hubs                             | Shared-funder, exchange withdrawal and routing counterexamples            |
| Hardcoded infrastructure lists                 | Versioned registry plus account/program/PDA/pool checks and review provenance                         | New-pool discovery and falsely-labelled-wallet regressions                |
| Unknown history interpreted too optimistically | Tri-state facts and confidence/coverage thresholds; unknown cannot satisfy cleanliness rules          | Deadline/429/missing-page reports remain partial                          |
| Budget not covering all IO                     | Absolute job deadlines, abort propagation, bounded retries and process/worker watchdog                | Slow launch, metadata and history providers do not exceed deadline policy |
| Unbounded incoming scans                       | Admission control, deduplication, bounded queues, per-user/IP quotas and priority fairness            | Overload simulation returns predictable 429/queue state                   |
| Constant-product estimate for all venues       | Correct curve/AMM math, effective reserves, fee handling and explicit unsupported venues              | Golden quotes, multi-pool cases, migration and signed-reserve fixtures    |
| Dropping out of top means "sold"               | Re-read old cluster owners and inspect transfers/trades regardless of rank                            | Falling-rank, transfers, burns and actual sales yield different events    |
| Cached data looks live                         | Freshness indicators, slot lag, bounded TTL and explicit stale output                                 | Stale provider/cache data visible in site and bot                         |
| Volatile jobs/notifications                    | Durable jobs, snapshots, subscription and outbox recovery                                             | Restart during scan and during notification tests                         |
| Score uncalibrated                             | Rule versioning, forward outcome collection, transparent heuristic label, chronological holdout       | Reproducible evaluation without invented accuracy claims                  |
| Frontend edited by string replacement          | Typed React components and shared API/event schemas                                                   | Build plus browser flows on desktop/mobile                                |
| Minimal release checks                         | Unit/integration/browser/live/load tests, operational metrics and restore drills                      | Stage 14 release evidence checklist                                       |

Fundamental uncertainty remains: public chain data cannot prove who a person is, and a scanner
cannot guarantee a token will not rug. Close engineering weaknesses and qualify inference; do
not replace uncertainty with promises.

## 6. Performance, quality and cost policies

Initial service targets, to measure and revise before launch (not product claims):

- Cached report response p95 < 500 ms and new job acknowledgement p95 < 1 s in the agreed load profile.
- Preview attempts have a 15 s absolute work deadline; waiting in the queue is separately visible.
- Deep analysis has a 120 s initial deadline; emit partial results with coverage when it cannot finish.
- Deep holder enumeration covers all returned indexed pages; history starts at 100 largest owners and
  expands toward 95% of circulating supply under a configured budget. These are caps/targets, not guarantees.
- Define minimum score eligibility from real fixtures: incomplete supply, unknown pool math, excessive
  unread history or too few real holders can yield insufficient data instead of a cleanliness score.
- Monitoring cadence starts at 15 min and is limited by provider cost. Report actual next check time
  when saturation prevents the nominal cadence.
- Interactive requests have reserved capacity; deep and monitoring queues cannot starve each other.
- Per-provider rolling request/credit budget, retry allowance and daily spend ceiling. Show cost per
  successful/partial scan internally and disable expensive expansion when the configured ceiling is hit.
- Preserve cancellation all the way into active fetches; use a worker watchdog if library work cannot abort.
- Cache immutable transactions/launch facts and incremental history separately from current balances.
- Retention policies: reports/outcomes, wallet evidence, jobs/events, queues, market candles and chat
  identities each get explicit TTL/archival rules. Deleting subscriptions does not erase public chain facts.

## 7. Stages, commits and acceptance gates

Each row is a separate local commit after its listed gate. Never push. If a stage expands materially,
split it into explicitly recorded sub-stages, each independently reviewable and checked.

### Stage 00 — environment and executable plan (current request)

Commit: `chore: bootstrap toolchain and full product build plan`.

Deliver dependency workspaces, exact lockfile, ignored local environment, Compose databases,
developer tools, browser binaries, this plan, architecture decisions, status and AGENTS instructions.

Gate: dependency compatibility/typecheck/format checks pass; Chromium launches; PostgreSQL query
and Redis ping pass. Record real versions, digests, credential configuration status and external
limitations. No claim that an application exists.

### Stage 01 — runnable foundation and contracts

Commit: `feat: add shared contracts and runnable application services`.

Implement validated environment schema; shared mint/report/evidence/job/event/error schemas;
separate API, worker, bot and web processes; migrations; structured redacted logs; health/readiness;
root development scripts and graceful shutdown. Connect package exports with strict TS configs.

Gate: all processes start; migrations apply to empty database; dependency readiness is accurate;
unknown/missing required configuration fails clearly; API and clients share versioned contracts.
Use placeholder UI only for development and do not hand it off as a completed website.

### Stage 02 — supported inputs and terminal integration

Commit: `feat: resolve Solana mint and terminal links safely`.

Accept bare mint, pump.fun token URL, GMGN Solana token URL and verified Axiom URL shapes. Strip
tracking/referral text safely, handle URLs identifying a pool, resolve pool to base mint, and
reject ambiguous/multiple unrelated addresses. Verify mint/program/decimals/authority from chain.
Build validated outbound Pump/Axiom/GMGN/Solscan links from resolved identities.

Gate: fixture matrix includes mints, token/pool URLs, queries, wrong chain, malicious hostname,
bad base58, wallet-as-token and unsupported pair. Verify actual terminal destinations through
read-only requests/UI; no arbitrary server URL fetching. Live credential access check occurs here.

### Stage 03 — holder index, snapshot consistency and provider resilience

Commit: `feat: index holders with snapshot quality and provider failover`.

Implement Helius mint pagination, owner aggregation, SPL/Token-2022 capability checks, index slot
lag and supply reconciliation. Record page slot spread; enforce retry/reconciliation policy when
live changes invalidate exactness. Verify pool/vault accounts with RPC and a versioned registry.
Build reusable cancellation, rate/credit budgets, circuit breakers and failover adapters.

Gate: enumerate a >20-owner token, consolidate multiple accounts, distinguish mint supply from
circulating float and excluded reserves, handle negative/overflow/truncated numeric data. 429,
cursor loops, timeout, partial pagination and inconsistent slots must yield explicit limitations.
Validate live Helius capabilities; ordinary top-20 RPC cannot satisfy this stage's full gate.

### Stage 04 — transaction decoding and market structure

Commit: `feat: decode Pump trades and token flows across migrations`.

Decode hash-pinned official Pump and PumpSwap IDLs with Solana Kit/codec adapters: account/event/instruction formats, legacy/v2/v3 variants,
quote assets, inner CPI instructions, versioned transactions/address lookups and fee retention.
Recognize routed purchases through terminal bots/aggregators by actual swap/flow evidence.
Support migrated pump tokens on identified external venues with an explicit capability matrix;
unknown venues still get distribution analysis with scenario unavailable.

Gate: golden raw mainnet fixtures with provenance cover curve, PumpSwap, migration, routed swap,
multi-hop, transfer, mint/burn, failed transaction and signed virtual quote reserves. Check owner
deltas without interpreting a missing receipt as a distribution. Parser version is persisted.

### Stage 05 — wallet history, funding and evidence graph

Commit: `feat: trace wallet relationships with evidence and confidence`.

Read prior trade history to entry with completeness markers; fresh/short-history/sniper/launch
signals; direct transfers; common distributors; bounded funding hops; service/hub exclusions;
behavioral timing/size evidence. Expand candidate owners beyond the top 20, with targeted
counterparty discovery and deep supply coverage. Version labels with review source/time.

Gate: deterministic fixtures for fragmented balances, shared CEX funding, one common payer,
independent bots with similar buys, soft/proven mixed edges and missing entry. Each visible edge
links transactions and states what it proves. No personal-identity claim or automatic hub gluing.

### Stage 06 — risk scoring and liquidity scenarios

Commit: `feat: compute versioned distribution risk and sell scenarios`.

Implement versioned rules/thresholds, separate risk and confidence, data eligibility, cluster
concentration and non-overlapping suspicious-supply accounting. Compute curve/AMM effects using
effective reserves, fees, signed adjustments and quote conversions. For multiple venues use
explicit supported routing/depth assumptions and bounds; concentrated/DLMM math requires its
own decoder/model, never summed vault balances fed into a generic formula.

Gate: bigint/Decimal invariants, independently checked reference quotes, monotonic scenarios,
zero/unknown reserve separation, fees, reserve adjustment, migration and partial-market fixtures.
Unknown data cannot improve confidence or claim clean distribution. Bot/site use identical metrics.

### Stage 07 — durable scan orchestration and public API

Commit: `feat: run cancellable scan jobs with durable live events`.

Integrate preview/deep pipelines, global priority/fairness, concurrent deduplication, admission
limits, cache versions, provider budgets, persistence and retries. Expose scan acceptance, status,
report retrieval and resumable SSE using stored monotonic event IDs. Implement immutable reports
and recent successful scans; partial previews remain visibly distinct.

Gate: duplicate requests share work; queue overflow returns a clear state; deadlines cancel late
IO; SSE reconnect receives missing events; worker/Redis restarts recover accepted database jobs;
late lower-quality results cannot overwrite newer reports. API errors are typed and redact secrets.

### Stage 08 — early buyers, history and accurate change detection

Commit: `feat: track early buyers and actual holder position changes`.

Track first buyers with transaction order, current balances, added positions, actual swaps,
transfers, burns and locks. Monitor old cluster owners outside the new ranking. Store successive
snapshots, reconcile supply/denominator changes and match evidence for movements.

Gate: rank change without sale creates no "sold" event; transfer to an owned address, transfer to
unknown owner, DEX sale, burn and lock are different; stale/partial snapshot pairs are not compared
as if complete. Early-buyer coverage/status is shared by reports and alerts.

### Stage 09 — complete website and event-driven spider visual

Commit: `feat: build the live scanner website and evidence workbench`.

Implement all required pages/user flows from section 2, component CSS tokens, fonts, chart,
relationship map/table, spiders, progress, evidence inspection, immutable links and terminal actions.
Use the Hallmark workflow when authoring the UI. Integrate the real API first; any optional demo
is labelled and never used as live proof. Map can simplify while deep scan continues.

Gate: production build succeeds; browser journey mint/link -> scan -> report -> evidence -> terminal
works; loading/queued/partial/stale/error states are truthful; no horizontal scrolling at required
mobile widths; keyboard/reduced motion/200% zoom work. Run browser QA on real data when keys exist.
Provide a local meaningful preview; this commit does not publish a website.

### Stage 10 — usable Telegram bot

Commit: `feat: add Telegram scanning and report interaction`.

Implement commands, private/group distinction, input validation, callbacks, progress edits,
deep-result updates, limits, escaped messages, terminal/report buttons and graceful 429 handling.
Development uses one polling instance; production webhook uses a verified secret and update dedupe.

Gate: real BotFather token is locally configured; verify getMe, command registration and webhook/
polling lifecycle without unsolicited outbound messages. User-triggered scan of a real token yields
the same report as web. Group command and callback authorization tests pass. Never send test messages
to a person's chat without their explicit instruction/user-triggered interaction.

### Stage 11 — persistent watchlists and notifications

Commit: `feat: add linked watchlists and reliable change alerts`.

Implement Telegram identity verification for site linking, nonce expiry/replay protection, sessions,
access checks, shared watchlists/preferences, bounded subscription caps and user deletion. Schedule
fair monitor jobs; diff quality-compatible snapshots; durable notification outbox, retry/cooldown,
quiet hours, batching and delivery state. Handle blocked bot and expired subscriptions.

Gate: one user cannot modify another's subscriptions; login replay fails; web/bot watchlists match;
restarts preserve settings and pending changes; 429/403 do not loop or lose the watch state; stale
data/rank changes create no false sale alert. Live delivery is verified through a user-triggered watch.

### Stage 12 — forward outcomes and calibration tooling

Commit: `feat: collect outcomes and evaluate risk rules transparently`.

Persist report/policy versions and future price/liquidity/supply outcomes. Define outcome labels
separately for market drawdown, liquidity withdrawal and confirmed malicious action; do not call
all price falls rugs. Track label provenance, censor unavailable tokens and avoid future leakage.
Provide reproducible chronological evaluation, calibration plots and FP/FN slices. Keep a held-out
dataset and display insufficient-sample status until real evidence exists.

Gate: evaluation reruns with the same dataset/version; no fabricated accuracy, leakage or automatic
threshold tuning from tiny samples; historical fixtures verify plumbing only. A live heuristic
release requires honest labelling; empirical predictive claims wait for sufficient collected outcomes.

### Stage 13 — security, operations and deployable release package

Commit: `chore: harden service boundaries and package production operations`.

Build production images for web/API/worker/bot, TLS/reverse-proxy templates, migrations/rollback,
restricted DB/Redis networks and least privilege. Add structured redaction, metrics dashboards/
alerts, rate/body/queue limits, quotas, service readiness, backups/restore, retention and incident
runbooks. Check credential exposure, CORS/CSRF/session auth, callback access, SSRF, SVG/metadata/XSS,
SSE connection limits and dependency audit. Apply the security review skill when this stage begins.

Gate: rebuild from clean clone; no secret in artifacts; production compose starts; restore drill
works; dependency findings fixed or specifically justified; public unauthenticated overload is
contained. Deployment instructions are complete, but deployment/push is performed separately by user.

### Stage 14 — mainnet acceptance and release evidence

Commit: `test: verify end-to-end mainnet readiness and release evidence`.

Run agreed real-token corpus covering curve, migrated token, many owners, fragmented clusters,
fresh/funded holders, unknown venue, stale market data and high activity. Record report quality,
cost and latency. Run browser/bot journeys, restart tests, load/soak and operational failures.

Gate: all required user journeys work end to end; SQL/queue/browser/decoder/math checks pass;
measured performance/cost fit the configured provider plan; every limitation is visible in the
product and release notes; required credentials are validated; no fixture masquerades as mainnet.
Publish local release checklist and exact evidence paths. No push or remote deploy by the agent.

## 8. Verification strategy

- Unit/property fixtures: precise amounts, canonical inputs, decoder invariants, hub exclusions,
  evidence confidence, scoring bounds and scenario math. Expected values come from independent
  references/golden chain observations rather than reimplementing the function under test.
- Integration: isolated PostgreSQL schema, Redis queues, deduplication, durable events/outbox,
  restart recovery and migrations. Include Windows/Linux compatibility where practical.
- Provider contract fixtures: raw redacted mainnet payloads with slot/signature/date and pinned
  parser/IDL versions. Record provider capability and plan restrictions explicitly.
- Live checks: token enumeration, selected wallet histories, decoded swaps/reserves and actual
  terminal URLs against mainnet. Store observation timestamps; do not promise an atomic snapshot
  from a page API that does not support historical pinning.
- Browser: supported input shapes, scan/deep completion, evidence drawers, sharing, terminal links,
  signed identity linking, watchlist access and failure/reduced-motion/mobile states.
- Telegram: API/mock tests plus user-triggered real interactions. No unsolicited test messages.
- Load/soak: queued scans, SSE fanout, monitoring coexistence, provider 429/downtime, DB/Redis restart,
  memory limits, deadline cancellation, bounded cache and API admission under public abuse.
- Quality evaluation: real chronological outcomes, separate labels and confidence, adequate sample
  sizes and honest unknowns. A few manually chosen tokens do not validate predictive accuracy.

Each stage records commands, environment, fixture/live distinction, results, remaining issues and
commit in `docs/STATUS.md`. Store detailed non-secret evidence under `docs/verification/` when useful;
large raw captures belong in ignored local storage with a documented fixture selection process.

## 9. Definition of a complete working project

The product is ready for user-operated deployment only when stages 01–14 meet their gates, the
site/bot operate against configured live data, monitoring is durable, the frontend is verified on
mobile, measured resource costs are acceptable, and install/deploy/backup/restore instructions
are reproducible. Readiness means a deployable, honestly labelled analysis tool. It does not mean
proven fraud prediction without sufficient forward data.

Stage 00 alone delivers the environment and this plan. Continue from `docs/STATUS.md` and commit
each subsequent completed stage locally. Do not push, launch a public site or message users as a
side effect of development.

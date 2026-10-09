# CrawlSpider implementation contract

## Authoritative user requirements

- Build an original, complete Solana token intelligence product inspired by CrawlScan.
- Deliver a real website and a Telegram bot using the same analysis results and watchlists.
- Support pump.fun / PumpSwap and Solana tokens accessed through Axiom and GMGN.
- Axiom and GMGN integration means token/link input and outbound terminal links. A browser extension and trading execution are not requested.
- Address the limitations recorded in `docs/BUILD_PLAN.md`; never hide missing data behind a clean verdict.
- Retain spiders or an equally distinctive visual. Use real scan events to drive motion.
- Work in stages. Make one reviewable local commit after each stage passes its applicable checks.
- NEVER run `git push`, publish releases, or deploy during this local build workflow. The user pushes independently.
- External provider and Telegram accounts exist. Configure credentials locally; never request secrets in chat, print them, or commit them.
- Work directly on `main`, as explicitly requested by the user. Do not create a prefixed branch.
- User clarification: the website stays in English. The user now authorizes a CrawlScan-inspired visual pass, using https://crawlscan.fun/ as reference and moving spiders as the principal detail. Implement it in place without waiting for `design.md`; do not claim final user acceptance.

## Start/resume procedure

1. Read `docs/BUILD_PLAN.md`, `docs/STATUS.md`, and `docs/DECISIONS.md`.
2. Inspect `git status` and recent commits. Preserve human changes and earlier stage results.
3. Continue the first unfinished stage, respecting its dependencies and acceptance criteria.
4. Update status with actual checks, limitations, and the next concrete task.
5. Stage explicit project paths, inspect the staged diff, and commit after verification. Do not blindly add the reference checkout, local configuration, reports, or runtime data.
6. Report the commit hash and completed stage. Do not call a stage complete when live/provider checks required by that stage have not passed.

## Implementation constraints

- The `crawlscan-review/` checkout is ignored reference material. Do not vendor its Git repository or copy code without retaining applicable MIT attribution.
- Use the exact dependency versions and lockfile. Normal clean installs use `npm ci`.
- Keep blockchain IO in provider adapters and scoring math in pure analysis functions.
- Every analytic claim must retain evidence, timestamps/slots, coverage, and rule/parser versions.
- Confirmed on-chain interactions and inferred common control are separate concepts. Never label inferred personal ownership as proven.
- Snapshot all reported metrics consistently. A paginated current-holder read is not automatically an atomic historical snapshot.
- Amounts use bigint / integer strings; decimal calculations use explicit precision. Never pass large raw token amounts through JavaScript `number`.
- All network work has cancellation, request deadlines, retries bounded by the overall deadline, and a shared provider budget.
- Queue and event state are durable. A worker restart cannot silently lose accepted jobs or subscriptions.
- No private blockchain keys or transaction signing. Solana Kit/codecs and pinned official Pump IDLs are used for read-only decoding/math; do not reintroduce the audited legacy SDK tree.
- No simulated fixtures or fabricated statistics in production. A demo is explicitly labelled and separated from live reports.
- Redis eviction is disabled for queue correctness; set bounded cache retention and memory alerts.
- Public scans are usable without Telegram login. Telegram identity is required only for persistent watchlists/preferences.
- Verify real behavior, not implementation-shaped unit tests. Use deterministic fixtures for parser/math invariants, integration tests for DB/queues, and browser tests for user journeys.
- A failed provider response becomes unknown/partial; it never becomes zero holders, zero previous activity, or a false sale.
- Use Hallmark for website visual work. Preserve the product's own brand and analytical semantics while applying the authorized reference direction. Respect the user's instruction not to run checks; record the resulting validation gap honestly.
- Frontend is static React/Vite. Hosting may serve the built frontend; long-lived workers, PostgreSQL and Redis run outside edge isolates. No hosting registration or deployment is part of this stage.

## Stage completion checklist

- Applicable typechecks, tests and build pass; changed services start successfully.
- Relevant failure paths, precision, data provenance and access controls are checked.
- Live claims have live evidence; pending credentials/provider capacity are explicitly recorded.
- Documentation and environment examples match actual behavior.
- `git diff --check` passes and staged files contain no credentials.
- Create the planned local commit, with no push.

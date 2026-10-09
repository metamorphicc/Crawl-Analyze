# Stage 07 — durable scans and public API

Implemented locally. PostgreSQL is authoritative for admission, accepted jobs, leases, cancellation,
progress, events and append-only report bodies. Redis/BullMQ is a replaceable dispatch transport.
No external provider acceptance is claimed without configured keys.

`POST /v1/scans` accepts a mint or supported URL and preview/deep mode. Mint URLs are normalized
locally; worker verification determines whether the address is actually a mint. Axiom pool URLs
require bounded chain resolution before acceptance. `/v1/resolve` remains available separately.
Active requests share a versioned mint/mode job, while a fresh same-mode/version report can be reused.
The creator alone receives a cancellation capability; its hash is stored and duplicates cannot
retrieve the original secret. Cancellation uses `POST /v1/scans/:id/cancel` with the
`x-scan-cancel-token` header. Neither job reads nor SSE expose it.

Routes:

- `GET /v1/scans/:id`: current phase, attempts, deadline, optional qualified preview and report ID.
- `GET /v1/scans/:id/events`: persisted monotonic SSE events; reconnect with `Last-Event-ID` or `after`.
- `GET /v1/reports/:id`: immutable historical report body.
- `GET /v1/tokens/:mint/latest`: newest observation under current contract/parser/rules.
- `GET /v1/reports`: latest 20 complete/partial reports, with explicit state and mode.
- `GET /v1/queue`: lane counts and configured admission capacity.

Database transactions serialize global admission and claims. Per-IP hashed buckets have minute/day
caps; raw IPs are not persisted. Backlog has a hard global limit. Preview, deep and dormant monitor
queues have separate workers; database claims enforce a global cap across processes. With default
concurrency four, one slot is reserved for preview, two for deep, one for monitoring. A single-slot
configuration admits the oldest queued request globally. Within each lane the oldest request wins.
Production proxy policy and final operational limits remain stage 13 work.

Work uses a 15-second renewable lease, a unique fencing token, at most three attempts and an absolute
deadline preserved across retries/recovery. Heartbeats, checkpoints and final writes check database
clock time and the token. An abort propagates into provider requests; a watchdog also rejects a
promise that ignores abort. Late results cannot write a report after cancellation, takeover or
deadline. Cooperative shutdown requeues eligible work. PostgreSQL recovers abandoned leases, and
the dispatcher reconciles accepted jobs into fresh Redis queues once per second. No global Redis
flush is used. Redis itself must remain available for provider rate-budget enforcement.

The real pipeline verifies the mint, enumerates holders, verifies exclusions, loads markets, emits
a qualified preview, reads bounded histories/funding and applies the stage 06 shared schemas.
Missing infrastructure verification also reduces quality. Preview caps holder pages at three and
does not pretend wallet/launch history is complete. Reports store up to 500 unique decoded
transactions, with an explicit cap limitation, and have an 8 MiB final-body limit. Oversized work
fails clearly; it does not publish an invented smaller complete snapshot. Market/quality freshness
uses observation times; queue waiting does not consume the work deadline.

Cache keys include mode and contract/parser/rule versions. Cached bodies must be observed within
`SCAN_CACHE_MS`; historical reads may be stale and keep their original timestamps. Newest reads
order by observation time, so a late older report cannot replace a newer observation. Bodies are
append-only through application write paths; reports are never overwritten in place. PostgreSQL
reports are committed with job completion and terminal event in one transaction.

SSE connections are bounded per API process, poll persisted events, apply stream backpressure,
heartbeat and close after a minute. Terminal events close the stream. Reconnects resume without
gaps using event IDs; snapshots are fetched from job/report endpoints rather than repeatedly
streaming large bodies. API errors and worker failure codes exclude provider URLs/credentials.

Validation: 117 unit tests, nine real-infrastructure integration tests, strict typecheck, all builds
and formatting passed. Integration covers concurrent dedupe, quotas, queue saturation, reserved
lanes, cancellation, recovered-worker fencing, cache expiry, watchdog/late result, isolated Redis
queue loss, runner restart, report reads and SSE cursor replay over real HTTP. Transport-loss tests
delete only their own test-prefix queues; they do not restart the user's Redis container. A live
provider scan and a production fault/load profile remain pending. Website journeys follow in stage
09; Telegram interaction and scheduled watch jobs remain stages 10–11.

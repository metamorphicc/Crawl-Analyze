# Data-ready findings and scan latency

The scan route now keeps the initial viewport until a report belonging to the accepted job and
mint loads. A visible guide points to the findings below. First preview or final-only report
causes one arrival; later updates never re-scroll or take focus. Charts still load automatically.
The report component retains its identity while its data changes, preserving search and focus.
Hidden tabs defer arrival and reduced-motion preferences disable smooth scrolling.

The verdict displays the holder observation time and a history-read count separately from
scoring coverage. Reads with missing receipts do not imply usable or complete history. Unsupported
Token-2022 extensions, missing usable entries/history and unverified markets are explained visibly.
Known concentrations remain available; absent hypotheses no longer imply measured zero control.

## Measured bottleneck

Public job `8e3295ae-401f-41b4-8934-a9ac7c25e150` produced a snapshot about 1.4s after worker start.
Wallet-history phase then lasted about 117s. The configured provider gate is 5 requests/s, deep
deadline 120000ms, and the history reader examines up to 40 successful receipts per candidate,
in addition to signature pages and bounded auxiliary reads. RPC errors/partial parsing and provider
retention can still leave unknowns. Increasing the rate requires actual provider capacity; this
change does not bypass that gate or lower analytical eligibility thresholds.

The collector now has bounded concurrency (default four, maximum eight), shared per-scan receipt
caching, stable candidate order, serialized incremental checkpoints and cancellation/deadline
handling. The worker publishes qualified reports during history collection instead of keeping
the initial zero-history preview until the final deadline. Funding remains explicitly unread in
those checkpoints; early-entry evaluation is qualified before final analysis.

Live browser/job verification on 2026-10-09 used the same mint:
`E71f3Ph24bCiG2kGL1M3ywJV1yMTUpGFsQnvoNGimoon`, job
`f83ee109-7978-4c23-b405-06e7576e8ff4`.

- Acceptance left scroll at zero; the first snapshot was persisted 2.605s after acceptance.
- Intermediate history checkpoints arrived during the run, beginning about 36s after acceptance.
- Final partial report persisted after 120.23s including roughly 1s of queue time.
- 16 of 17 indexed owners had a history read; 462 receipts decoded, with missing/limited windows.
- Browser emitted zero page errors; the timestamp and missing-data explanation were visible.

The full scan did **not** become instant. This mint still uses unsupported Token-2022 extensions
18/19 and has no supported verified fresh market in the report. A score and sell scenario therefore
remain unavailable. Chart venue coverage is also unchanged. These are remaining implementation
limits, not evidence that the token is safe. One live run is not a broad performance benchmark or
stage-14 mainnet acceptance. The existing website-wide background and spider renderer are unchanged.

## Verification

Unit regressions cover concurrent progress before a slow wallet finishes, deterministic order,
shared receipt reads, cancellation and failed checkpoints. The browser journey covers no early
jump, one data-ready arrival, timestamp, retained focus on completion, automatic charts and no
pause controls. Other parser/analysis, durable integration and browser journeys are also run.
Typecheck, 158 unit tests, all 21 integration tests and all 11 browser journeys pass. An initial
integration attempt failed the existing outcome-scheduler read-count assertion while the live
worker was also running; the complete retry passed. No outcome scheduler code/test was changed,
and that intermittent failure is not claimed fixed by this scan change. Formatting/diff checks
also pass, as does the full production build. Only the idle worker was restarted locally; no push
or deployment was performed.

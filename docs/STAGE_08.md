# Stage 08 — early observations and position changes

Implemented locally. Reports add optional validated early buyers, changes and targeted balances.
Historical report bodies remain readable. Live provider/launch acceptance is still pending keys.

The launch adapter reads at most two Pump curve history pages of 50 signatures/100 transactions.
A verified launch requires a matching actual Pump create/create_v2 instruction. Missing or ambiguous
creation is unknown. First observations require decoded buy calls and positive acquisition evidence;
transfers, failed calls and receiptless instructions are not buyers. Decoders and change analysis
share one pure exact-receipt attribution function, including mixed-leg safeguards.

Within-slot order comes from up to four RPC block signature lists. Lexical signature order is never
presented as transaction order. Unknown-order tied slots are candidates; launch-slot proximity is
null. Lists retain their covered-window scope, history/transaction (500 relevant transactions)/display
(100 buyers) caps, and migrated-venue limitations. Missing holder pages give null balances; absent
owners become zero only under a complete qualified enumeration. Score signals cannot upgrade an
unknown early-buyer ordering into a verified early-entry claim.

Previous flagged owners and early buyers are reread independently of current rank. The adapter
checks all returned owner token accounts for mint/program/authority, deduplicates and sums bigint
amounts. Up to 100 prior owners receive direct position checks and up to 25 receive priority history
within the global history budget. Unsupported Token-2022 extensions and failed/deadline reads stay
unavailable. A successful empty owner-account response means zero; a failed response never does.
Delegated allowance is capped by the remaining spendable balance for distribution metrics.

Comparison uses the union of owners from both snapshots, not a top-N list. It requires reconciled
complete snapshots, unchanged mint identity/supply/exclusion denominator, fresh observation metadata,
ordered nonoverlapping slot intervals and an observation gap <=1 hour. A direct owner read disagreeing
with the index disables comparison. Partial/stale pairs do not receive invented zero balances.

Comparable pairs store balance deltas and unexplained residuals separately. Only successful decoded
transactions after the old maximum slot and through the new minimum slot explain the interval.
Exact Pump receipts classify buys/sells; ambiguous instructions remain `trade-observed`. Consumed
swap receipts are not counted twice as distributions. Failed/duplicate/out-of-window transactions
cannot repeat a sale. Missing evidence remains an unexplained balance change.

Transfers, same-owner account transfers, burns, mints, frozen-balance and delegated-balance changes
have distinct kinds and references. Transfers within an inferred group keep `identityProven: false`.
Supply changes disable balance comparison while valid burn/mint evidence remains factual. Frozen
state is not a time-lock proof; unknown lock programs need dedicated adapters. No transfer alone is
labelled locked or sold.

Migration 003 atomically persists report positions, signature/parser transaction records, verified
launch references and comparisons with fenced report completion. A previous report must belong to
the same mint. Historical bodies are append-only. Continuous schedules and notifications arrive in
stage 11; stage 08 persists changes whenever another deep scan runs.

Validation: 136 unit tests and ten real PostgreSQL/Redis integration tests, strict typecheck and full
builds. Fixtures cover ordered/unknown early entries, direct large-value owner balances, rank changes,
transfers, unproven groups, ambiguous/exact sells, burn/mint, frozen state, partial/stale pairs and
unexplained decreases. Integration verifies successive snapshot/comparison persistence. Mainnet
transaction, launch, position and provider archive acceptance remain pending.

RPC shapes follow official [getBlock](https://solana.com/docs/rpc/http/getblock) and
[getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner) documentation.

# Stage 05 — histories, funding and evidence graph

Read wallet and current token-account histories with bounded pages, decoded transactions and
deadline propagation. A job-wide transaction cache prevents repeated reads of shared signatures.
Missing receipts, parser limitations, pagination/transaction limits and archival uncertainty are
retained. `getSignaturesForAddress` covers the provider's retained window; exhausting it cannot prove
a wallet was newly created. Previous Pump activity is a lower-bound observation, and absence is only
scoped to a fully decoded retained window. Other DEX history is unknown. No unknown wallet is called
fresh, clean or inexperienced. Entries are earliest observed acquisitions, not guaranteed lifetime
first entries. Early-launch signals require supplied verified launch evidence.

History selection starts with at least 25 eligible owners when available, expands toward 95% of
the nonexcluded indexed balance under an owner cap, and can target small observed counterparties
outside the initial ranking. Selected supply and actually read history are different coverage metrics.
Multiple token accounts consolidate to one owner; self transfers are not new acquisitions.

Funding traces follow native transfers causally backward before each outgoing hop/entry, with
node, fanin, slot-lookback, minimum-amount, depth and deadline bounds. Incoming funding proves a
transfer, not its purpose. Default limits are 2 hops, 20 additional wallets, 2 funders per node.
Trace boundaries and missing histories are explicit; no exchange withdrawal is identity proof.

Graph rule `relationships-1` distinguishes factual transfers/funding, common-source hypotheses,
timing/size hypotheses and corroborated common-control hypotheses. One payer alone and similar buys
alone never create a control group. Corroboration requires funding plus separate token-transfer/
distributor evidence plus acquisition proximity, with distinct signatures. Reviewed service labels
carry source, version and review/expiry times; observed fanout >=6 is conservatively treated as a hub.
Known service ancestors and hubs cannot supply control evidence. Each edge cites transactions and
states its inference. Mixed graph components group only corroborated edges; soft links never upgrade
other wallets. Group identity remains explicitly unproven.

Validation includes >20-owner fragmented balances, targeted counterparties, missing entry, bounded
histories, causal funding, CEX/hub exclusion, a common payer, independent bots, mixed soft/control
components and duplicate evidence. Live history coverage and labels are pending provider keys.

Developer end-to-end evidence command:

```sh
node --conditions=development --import tsx tools/analyze-evidence.ts <mint-or-url>
```

This runs actual adapters when configured and saves a timestamped inspection artifact in ignored
`.local/evidence/`. It is not a public immutable report API: durable scans/reports arrive in stage 07.

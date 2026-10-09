# Stage 06 — distribution risk and sell scenarios

Implemented locally, 2026-10-09. This stage does not start public scan jobs or claim mainnet
acceptance. It adds pure analysis functions and versioned shared contracts to the actual-adapter
inspection command. Website styling remains deferred.

## Shared output and eligibility

`assessRisk` produces `heuristic-1`: higher points indicate more observed distribution/authority
risks. It is explicitly heuristic and uncalibrated. `riskScore` is null and classification is
`insufficient-data` when eligibility fails; observed rule points remain available with qualified
metrics. Those points are not a guaranteed lower bound: missing pages can inflate concentration.

The denominator is the indexed owner balance minus verified infrastructure exclusions. It is
neither automatically circulating market float nor a count of persons. Balances must already be
aggregated by owner; duplicate owners are rejected. A snapshot exceeding mint supply can survive
as a partial report, but cannot become eligible. Frozen/delegated exclusions with uncertain overlap
also prevent eligibility.

Eligibility requires a complete, supply-reconciled holder snapshot and mint state observed within
120 seconds, at least five nonzero eligible owners, reviewed token semantics, known account flags,
usable retained-window history and observed acquisition entries for at least 80% of eligible
balance, an available fresh market model, and no unknown score rule. Rule absence is qualified to
observed coverage. A missing launch/early-entry assessment or incomplete graph can prevent a
verdict even when concentration is measurable. In particular, the current developer command does
not yet fetch verified launch history; early-entry acceptance arrives in stage 08.

The data-completeness number is separate from risk: 35 points for reconciled fresh holders, 10 for
reviewed fresh mint metadata, 15 for market-model availability, up to 25 weighted by usable history
balance, 10 by known-entry balance and 5 by known early-entry balance. It is capped at 95 because
retained RPC windows cannot establish lifetime history. It is not a success probability, identity
confidence or predictive accuracy. Losing a data source cannot improve this number.

## Initial rules

These thresholds are explicit starting policy, not statistically fitted claims. Stage 12 will
collect forward outcomes and evaluate them separately from the data-completeness policy.

| Rule                                             | Threshold | Points |
| ------------------------------------------------ | --------- | ------ |
| Largest eligible owner                           | >=20%     | 25     |
| Largest ten eligible owners                      | >=60%     | 20     |
| Largest corroborated control hypothesis          | >=20%     | 25     |
| Active mint authority                            | Present   | 20     |
| Active freeze authority                          | Present   | 10     |
| Frozen eligible balance                          | >=10%     | 10     |
| Delegated eligible balance                       | >=10%     | 5      |
| Observed buyers within verified launch proximity | >=25%     | 10     |

The sum is capped at 100; eligible scores below 30 are low, 30–59 moderate and >=60 high. These are
distribution-risk classifications, not a fraud verdict. A verified interaction still does not
prove personal identity. Absent facts are tri-state rules, never an automatic cleanliness reward.

The scenario cohort unions concentrated owners (>=20%), members of corroborated control
hypotheses and verified early observed buyers. A balance appears once even when hypotheses or
signals overlap. Group balances are recomputed from unique current eligible owners, not trusted
from a supplied aggregate. Common payers and matching bot timing alone cannot enter this cohort
as a control group. Flagged balance is an investigative selection, not proof its owners will sell
together. Every output preserves analysis time, evidence references and rule/model versions.

## Exact sell model

Model version: `pump-sell-1`. Amounts, products, floors and fee ceilings use bigint. Human quote units
and impact percentages use an isolated Decimal context with precision 100 and explicit rounding.

For base input `x`, base reserve `B` and effective quote reserve `Q`:

```text
gross = floor(Q*x/(B+x))
fee(component) = ceil(gross*bps(component)/10000)
net = gross - LP fee - protocol fee - creator fee
minQuote = floor(net*(10000-slippageBps)/10000)
```

Each fee rounds independently. Creator fee is zero when the coin creator is the zero key. A
configured per-coin creator rate replaces the schedule rate only when its global gate is enabled.
Buyback is a split of protocol fees, never an additional fee counted twice.

For PumpSwap, `Q = quoteVaultBalance + signedVirtualQuoteReserve`. Real spendable quote is
`quoteVaultBalance - protocolFees - creatorFees`. Accrued fees are already represented in the
signed virtual reserve; do not subtract them again from `Q`. The real reserve must cover
`gross - LP fee`, including creator/protocol portions, not merely the user's net payout. The AMM's
post-sale effective quote is `Q - (gross - LP fee)` because LP fees remain in the reserve.

For a depth-zero active Pump curve, `B` and `Q` are virtual reserves, LP fee is zero, and the real
quote reserve must cover gross output. Complete/migrated curves require an identified active AMM;
they are not zero-impact scenarios. Mayhem and composite/multihop variants remain unavailable
until dedicated protocol acceptance. Account versions with missing fields or nonzero unknown
trailing bytes also remain unavailable. Allocated zero padding is retained separately from unknown
nonzero fields; no compatibility claim is made for future program upgrades.

Fee tiers come from the observed mandatory on-chain FeeConfig, not marketing rates or a failed-IO
fallback. Canonical SOL-like quotes use SOL tiers; mainnet USDC uses stable tiers; other quotes use
exotic flat fees (all-zero unset falls back to flat); noncanonical pools use flat fees. Thresholds
are in the quote mint's raw units. Normal curves use the fixed protocol supply basis of 10^15;
normal pools use observed mint supply. Unknown global gates/configuration cannot satisfy the model.

Available scenarios require market observations <=60 seconds old, fresh mint state, optional
reference-slot drift <=150 slots, positive effective reserves, u64-compatible on-chain reserve/input
arithmetic, sufficient spendable liquidity, and supported token semantics. Frozen or uninitialized
vaults are rejected. Arbitrary Token-2022 extensions are still conservative unavailable states;
their inventory and distribution evidence remain visible. Tiny sales whose rounded fees consume
their output are explicitly unavailable.

Reported execution impact compares gross average execution with the initial spot price, while
post-sale spot drop uses post-sale reserves. Net output shows the separate fee cost. Quote raw
units remain available when quote decimals are unknown; display units are null. No USD price or
conversion is invented, including for USDC.

## Multiple venues

The default scenarios sell 25%, 50% and 100% of the cohort. Each identified venue receives an
independent single-sale quote. For each quote mint, outputs offer the best available single venue
and, when feasible, an equal split across its known active venues. Split inputs preserve every
integer unit. Pools must be distinct, the same quote mint, and within 32 slots of each other.
Real-liquidity constraints apply separately to each leg. Partial-market failures retain unavailable
quotes and do not become zero-impact alternatives.

These routes establish achievable output in the stated model, not a global optimum or execution
guarantee. Discovery is not exhaustive; no CLMM/DLMM vaults are summed into constant-product reserves,
and different quote currencies are not combined. Assumptions exclude competing trades, MEV,
network/router fees and unproven wallet transfer restrictions. An inconsistent cohort above mint
supply is preserved with a limitation; a sale above known supply is unavailable.

## Independent references and verification

Reference math was checked against the publisher sources in `@pump-fun/pump-sdk@4.0.0`
(`src/fees.ts`, `src/bondingCurve.ts`) and `@pump-fun/pump-swap-sdk@2.1.0`
(`src/sdk/fees.ts`, `src/sdk/sell.ts`, publisher sell tests). Their dependency trees are not installed
or executed. The attributed publisher fee-account capture is committed under `tests/fixtures/`
with original source/archive SHA256, capture date, slot and account. It was not independently
refetched by this project. The importer verifies both hashes and extracts literals with a
TypeScript AST; it never evaluates retrieved TypeScript. Reproduction requires the pinned archive
in ignored `.local/protocol-sources/`; its SHA256 is in the fixture and importer. See
`tests/fixtures/NOTICE.md` for attribution and MIT terms.

Publisher sell examples produce gross/net outputs 99800399/98552892 and
20196078431/20145588234, including independent fee ceilings, creatorless and boosted states.
A large-integer rational quotient was also checked with Python `fractions.Fraction`, independent
of the TypeScript implementation. Tests sweep both curve and AMM inputs for increasing proceeds
and spot impact, and verify sweep invariance, real-output constraints, quote schedules, creator
gates, amount bounds, unavailable states, currency separation, split routing, overlapping cohorts
and data-loss confidence/eligibility.

Protocol explanations also follow the official
[signed-reserve specification](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md),
[fee program documentation](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/FEE_PROGRAM_README.md)
and [sell instruction documentation](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/instructions/SELL.md).
The pinned SDK source is the reference for quote-schedule and per-coin gate details.

Locally verified: 117 unit tests, 3 real PostgreSQL/Redis integration tests, strict typecheck and
full workspace/web build. Live reserve/account captures, transaction corpus and production scoring
acceptance remain pending provider configuration. No predictive validation claim is made.

Run the actual-adapter inspection command after locally configuring provider keys:

```sh
node --conditions=development --import tsx tools/analyze-evidence.ts <mint-or-supported-url>
```

It saves identity, qualified holders, histories, funding, graph, markets, risk and scenarios to an
ignored timestamped `.local/evidence/` artifact. All three analytics sections pass shared Zod
contracts. Public immutable reports, persisted scan execution and bot/site consumption arrive in
later stages. The user requested a stop after this stage; stage 07 has not begun.

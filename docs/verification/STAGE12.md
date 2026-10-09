# Stage 12 — forward observations and rule evaluation

Policy `forward-1` freezes a baseline once, with the report's immutable rule/parser versions.
Observation time is recorded independently from report time. A baseline must arrive within two
minutes after the report; historical reports never acquire an invented historical spot price.
Horizons are 1h, 6h and 24h from the baseline observation. Sampling more than five minutes late
is censored. Restarting the scheduler preserves baseline and completed outcomes.
Retrieval time is known; the underlying market tick's time is not supplied by this endpoint.
`freshnessUpperSeconds` therefore remains unknown: the nominal cache policy is not a guarantee
that an illiquid token has a recent trade. Evaluation observes this provider's quoted price.

Pool identity is verified against the report's supported market and GeckoTerminal's token
relationships. A fixed HTTPS endpoint, bounded response, deadline and global six-second market
gate share the provider budget with charts. USD price/liquidity fields retain decimal strings;
supply is independently read with slot provenance. Unavailable or unlisted curve markets remain
censored. Public market data is cached up to one minute according to the
[official API specification](https://api.geckoterminal.com/docs/v2/swagger.json); it is not an atomic
on-chain liquidity measurement. No outcome data changes a historical score.

The market drawdown label means price at the horizon is at least 50% below the baseline; it is
not maximum intra-window drawdown. A USD liquidity-depth decline is a separate observation and
does not prove liquidity removal. Liquidity withdrawal and confirmed malicious action remain
unknown without independently reviewed action evidence; a falling price is never called a rug.

Run `node --conditions=development --import tsx tools/evaluate-outcomes.ts` after collecting live
data. It writes an ordered dataset, SHA-256 fingerprint, evaluation JSON and SVG calibration
plot under ignored `.local/evaluation/`. Export contains public report/mint identifiers, no
Telegram identity or credentials. The earliest sample per mint is preselected, tokens are split
chronologically 80/20, and training labels must mature before the holdout begins. Versions and
horizons cannot mix. The threshold 50 is fixed before evaluation; no automatic tuning occurs.
The plot shows observed frequencies per heuristic-score bin, not a predicted probability.

At least 200 mature training tokens, 100 usable holdout tokens and 30 of each label are required
for descriptive confusion/FP/FN output. Those minimums are safeguards, not proof of generalization.
Until sufficient real forward data exists, status is `insufficient-sample`; synthetic unit data
verifies plumbing only. The product continues to say uncalibrated heuristic.

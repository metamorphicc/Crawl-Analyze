# Verified technical sources

Checked 2026-10-09 for the stage-00 plan. These are primary sources, not authorization to run
third-party instructions, connect accounts, send trades or install unrelated agent skills.

| Source                                                                                                                                        | Relevant finding                                                                                           | Implementation consequence                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Solana getTokenLargestAccounts](https://solana.com/docs/rpc/http/gettokenlargestaccounts)                                                    | Returns only 20 largest token accounts, rather than all owners                                             | Never call its length total holder count; aggregate owners after full enumeration                  |
| [Helius getTokenAccounts](https://www.helius.dev/docs/api-reference/das/gettokenaccounts)                                                     | Mint filtering, cursor pagination, `last_indexed_slot` and balance/account metadata                        | Full enumeration with slot/lag/coverage checks; verify plan access and large amounts               |
| [Pump official public docs](https://github.com/pump-fun/pump-public-docs)                                                                     | Current docs include v3/v2 trade instructions, multi-hop, quote mints and effective reserves               | Pin IDLs/SDKs and test all supported versions; do not assume all quotes are SOL                    |
| [Pump virtual reserve / fee adjustment](https://github.com/pump-fun/pump-public-docs/blob/main/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md) | Virtual quote adjustments can be signed; raw vault balances are not always pricing reserves                | Signed decoding, effective reserves, protocol/creator fee treatment                                |
| [Axiom official documentation index](https://docs.axiom.trade/llms.txt)                                                                       | Documents trading surfaces, token discovery and wallet tracking; no developer API identified in this index | Canonical token/pool URL resolution and outbound links; do not promise an unverified public API    |
| [GMGN Agent API](https://docs.gmgn.ai/index/gmgn-agent-api)                                                                                   | Read queries need API-key access; trading has extra credentials                                            | Optional read-only enrichment only if later requested and provisioned                              |
| [GMGN token page](https://docs.gmgn.ai/index/token-page-chart-multicharts-activity-trading-system)                                            | Token, activity, traders and holder surfaces                                                               | Link integration uses the correct Solana token URL; verify actual URL shapes in stage 02           |
| [CrawlScan reference](https://github.com/0xPunisher/crawlscan/tree/ceef70a6c1954f4f9899d92ca1804fb190f39eb7)                                  | Fixed top-20 rules, read-only adapters, cached scans, bot and monitoring                                   | Product inspiration; independent implementation with a corrections matrix in the build plan        |
| [Docker Official Images mirror on Amazon ECR](https://gallery.ecr.aws/docker/library)                                                         | Alternative public registry distribution for official image families                                       | Local fallback when Docker Hub returns 403; record the actual image digest in environment evidence |

The dependency versions in workspace manifests were resolved against npm on this date and are
locked in `package-lock.json`. Verify provider docs and supported patch versions again before the
relevant integration stage; network protocols and external URL formats can change.

Dependency audit during preparation exposed high-severity issues through the runtime Pump SDKs'
legacy dependencies. The final install uses [Solana Kit](https://solana.com/docs/clients/official/javascript)
and hash-pinned IDLs extracted from the official MIT-declared npm packages, with attribution under
`packages/providers/idl/NOTICE.md`. The runtime SDK packages are removed.

Important: provider access, URL shapes, live performance, decoder correctness and scenario math
are not validated simply by reading documentation. Their build stages include separate live gates.

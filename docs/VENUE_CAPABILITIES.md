# Venue capabilities

| Source                                 | Read/normalize                                                                   | Sell scenario                                                     | Current acceptance                                            |
| -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| SPL Token                              | Mint, authorities, balances, transfers, mint/burn                                | Via identified venue                                              | Synthetic precision/flow fixtures                             |
| Token-2022                             | Mint/TLV inventory, base balances, standard instructions                         | Unreviewed fee/hook/confidential semantics unavailable            | Live extensions pending                                       |
| Pump curve                             | Hash-pinned legacy/v2/v3 instructions/events/account prefix                      | Implemented depth-zero model after current fee/version validation | Publisher quotes/synthetic invariants; mainnet corpus pending |
| PumpSwap                               | Hash-pinned legacy/v2 instructions/events, signed i128 reserves, verified vaults | Implemented effective reserves, fee buckets and current fees      | Publisher fee capture/quotes; mainnet corpus pending          |
| Pump multi-hop/v3 synthetic completion | Calls and component flows retained                                               | Composite scenarios unavailable until golden verification         | Explicit limitation                                           |
| Other migrated Solana venues           | SPL flows, owner balances, history                                               | No constant-product assumption                                    | Mint input accepted; pair resolution requires adapter         |
| Axiom / GMGN                           | Token/link input and outbound terminals; underlying on-chain calls decoded       | Same identified chain venue                                       | Real terminal destinations pending                            |

Account parsing exposes missing appended fields and trailing bytes, distinguishing zero allocation
padding from nonzero unknown content. It never treats a future layout
as fully verified. Older published prefixes remain identifiable; account variants retain their
limitations. Transactions use RPC `encoding: json`, including ALT loaded writable/readonly addresses
and inner CPI instructions. Missing token owners/balances cannot become distributions. Failed
transactions yield no executed flows or trades. One transaction's net owner delta cannot be assigned
to several same-mint swap legs. Native balance deltas are not substituted for exact quote payments.

Event attribution checks the runtime invocation stack. A router's log text cannot impersonate a
Pump event. Public interaction evidence is separate from wallet identity/control inference.

[Pump's signed-reserve specification](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md)
defines effective AMM quote reserves as raw vault balance plus the signed virtual reserve. Retained
fees are already represented in that signed field and must not be subtracted twice. Legacy appended
fee counters default to zero only under that documented compatibility rule.

[Official fee logic](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/FEE_PROGRAM_README.md)
uses on-chain configuration and distinguishes canonical/noncanonical pools. No hardcoded marketing
fee or claimed USD liquidity is substituted for unavailable state.

Stage 06 has pure single-venue sells and explicit same-quote known-venue alternatives; see
`docs/STAGE_06.md`. No generic model is applied to unknown migrated venues, and Token-2022
extensions remain conservatively unavailable until their effects are reviewed.

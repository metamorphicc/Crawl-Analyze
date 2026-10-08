# Stage 02 verification

Implemented canonical resolution and RPC mint verification. Run:

```sh
npm run typecheck
npm test
npm run build
node --conditions=development --import tsx tools/live-check.ts
```

31 unit tests passed (including precision, malicious hostnames, wrong chains, conflicting inputs,
wallet/token-account rejection, malformed extensions and 429 fallback). Mainnet check is pending
the local provider configuration. Do not treat deterministic synthetic account fixtures as mainnet
proof. The repository holds no external secrets.

PumpSwap pool layout and program identifiers are checked against the original hash-pinned IDLs.
Other pool venues deliberately require the underlying mint until a verified adapter exists.

Terminal links point at official hosts. Read-only retrieval confirmed the
[GMGN Solana route](https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112)
and [Pump coin route](https://pump.fun/coin/So11111111111111111111111111111111111111112)
serve their applications. This does not verify every token destination. Axiom retrieval failed;
browser token/pool navigation is still a live acceptance item. Its
[official documentation index](https://docs.axiom.trade/llms.txt) does not establish a public
resolution API, so the implementation uses program-owned account evidence, never undocumented
scraping or arbitrary URL fetches.

[GMGN's documented API](https://docs.gmgn.ai/index/gmgn-agent-api.md) distinguishes query access
from trading credentials. This product uses analysis and terminal links only.

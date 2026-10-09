# Result workbench from the user's video reference

The 2026-10-09 video of CrawlScan supplies the missing scan/result interaction reference:
compact scan status and elapsed time, a mint-centered wallet scene during analysis, then market
candles, a dense holder/flag table and a prominent verdict sidebar. Lower sections cover early
buyers, criteria and worker activity. The browser-extension error overlay in the capture is not
part of the requested design.

The implementation uses the existing CrawlSpider typography, palette and routes. No reference
JavaScript, example addresses, fabricated scan events or score values are copied. The durable
API/worker/bot/PostgreSQL/Redis architecture remains in use; the cancelled ephemeral refactor
is not resumed.

## Applied interaction

- Live token scans use a dedicated crawling scene, real worker phases, a since-request timer
  including queue time and a bounded recent SSE-event trace. Received events are server events,
  not invented per-wallet completion logs. Preview wallets appear only after actual holder data
  arrives; there is no fake ring of wallet addresses before enumeration.
- Up to 24 observed addresses appear around the mint. Risk/evidence endpoints get priority,
  followed by indexed holders. Dotted mint spokes indicate indexed membership only. Direct
  interactions, inferred control and behavioral hypotheses have distinct line styles and a legend.
  Up to 80 collected edges are displayed; counts and the complete equivalent tables disclose caps.
- The wallet scene reuses the exact homepage Canvas spider renderer: identical anatomy, planted
  legs, foot glows and fading trails, rather than separate SVG models. Crawlers are section-bound.
  Wallet buttons drift gently; spokes and evidence edges follow their actual moving endpoints.
  Green outbound / blue returning pulses link the mint with observed indexed wallets. Packets on
  collected evidence edges retain their semantic colors. Rotating arcs and contact flashes animate
  the center and arrivals. These are decorative effects, never new observations or coverage claims.
- A persistent website-wide blurred Canvas layer contains an abstract network, drifting junctions, orthogonal
  routes, traveling packets and expanding rings. It contains no token addresses or invented data.
  It is mounted once in the shared layout across scanner, token, report, watchlist, methodology
  and status routes. Foreground labels, node buttons and evidence hit targets remain sharp.
- Ambient motion continues in the saved-report map without refreshing the report. One clock and
  shared persisted pause controls spiders, wallets, packets, arcs and the website background together. OS reduced motion,
  tab visibility and offscreen suspension are respected; returning resumes preserved scene time,
  spider positions and trails. The global background continues outside the map, runs at 30 fps
  and suspends in hidden tabs; OS reduced motion leaves it static. Homepage spider boundaries remain.
- Address selection works through node buttons or a native wallet picker. Zoom, reset and pointer
  panning are available. Selected addresses expose balance only when indexed, flags, relationship
  context and evidence/transaction actions. No inferred identity becomes proven ownership.
- The report places source-backed metrics and the market chart above holders and a verdict sidebar.
  The chart loads for final reports, remains optional for previews, and preserves exact candle
  values/attribution. Missing candles are explicitly unavailable; no market cap or volume is invented.
- Wallet rows show short addresses with full-address titles, eligible-balance shares, qualified flags
  and expandable exact amount/account details. Zero denominators yield unknown shares. Unread history
  is not displayed as a clean wallet or proof of freshness.
- The verdict keeps CrawlSpider's original direction: higher risk score means more risk. No eligible
  score displays a question mark and an explanation. Coverage is not predictive accuracy. The summary
  sell scenario derives from supported quotes for a full flagged-cohort sale, not a prediction.
- Early buyers and risk criteria remain visible. Wallet graph/equivalent tables, sell calculations,
  position comparisons, provenance and future observations are grouped in expandable sections.
  Permanent links, JSON export, watchlist access, terminals and immutable historical reports remain.
- On narrow screens the verdict precedes the holder table. Table scrolling is contained. The homepage
  canvas still belongs only to the hero and is unchanged; the result scene is a separate bounded layer.

## Delivery and limitations

The user explicitly disabled checks. No tests, typecheck, browser walkthrough or live-provider
requests are run for this pass. A frontend production build only generates local serving assets.
Source implementation and build output do not establish visual/mainnet release acceptance. The
user still needs to review a real scan against their configured providers. No server start, push
or deployment is part of this visual substage; stages 13 and 14 remain pending.

Asset generation: `npm run build --workspace @crawlspider/web` completed successfully. Windows
blocked `npm ci` while native modules were in use; `npm install --ignore-scripts --no-audit --no-fund`
restored dependencies without changing the checked-in lockfile. Existing processes were not stopped.

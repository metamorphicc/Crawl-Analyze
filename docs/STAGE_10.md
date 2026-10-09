# Stage 10 — Telegram scan interaction

Implemented locally on `main`; no push, deployment or unsolicited Telegram message.
Live acceptance is pending: the ignored local environment has no BotFather token or Solana keys.
This is an implementation checkpoint, not a passed mainnet bot gate.

Private messages accept mint/Pump/GMGN/Axiom input. Groups ignore ordinary text and accept explicit
`/scan`, including addressed commands and preview mode. `/start`, `/help`, `/status` are useful;
watch/settings commands explicitly report that stage 11 is pending. Channel/bot-origin messages
are ignored. No wallet or signing is required.

The bot uses shared parsing, account verification, provider budget, admission, cache, jobs and
immutable reports. Acceptance and the owning user/chat/message binding commit atomically.
Durable scan requests update one acknowledgement with preview and final report. Summaries separate
risk from completeness, include concentration, coverage, early buyers, qualified sell output and
web/terminal links. HTML is escaped and callbacks enforce original user, chat and message. Axiom
account verification can delay admission/acknowledgement by its bounded deadline; bare mints do
not need that extra IO. Telegram/global/chat cooldowns persist, and 429 respects `retry_after`.

Polling commits each fetched batch and next offset before acknowledging with another `getUpdates`.
Storage failure retries the old cursor. The cursor expires after six idle days because Telegram
can randomize IDs after a week. Webhooks compare a 32–256 character secret in constant time, cap
bodies at 256 KiB and return 200 only after durable insertion. Update IDs deduplicate delivery.
A session advisory lock allows one runtime per database; losing it stops intake. Polling refuses
an existing webhook. HTTPS webhook registration retains pending updates.

Ambiguous initial sends become `uncertain` and are never blindly resent. Known message edits can
retry bounded network failures. A crashed non-scan handler records uncertain processing; users can
repeat commands. No exactly-once external-delivery claim is made. Raw bodies clear after handling;
operations-stage retention expires old dedupe/cooldown rows. No production fixture or test send.

Fill credentials only in ignored `.env`, run `npm run db:migrate`, then worker and `npm run dev:bot`.
Default mode is polling. Webhook mode also requires `TELEGRAM_WEBHOOK_URL=https://<host>/telegram`
and a random `TELEGRAM_WEBHOOK_SECRET`. Its loopback port is `TELEGRAM_PORT=3002`, behind the later
reverse proxy. `PUBLIC_WEB_URL` must be reachable by users; never expose secrets via `VITE_`.
Startup performs getMe and command registration; webhook mode registers the configured webhook.
The read-only `node --conditions=development --import tsx tools/telegram-check.ts` checks getMe and
webhook presence without sending messages or altering settings. Actual keys, lifecycle and a
user-triggered real scan remain required for live acceptance.

Verification uses real PG/Redis plus an intercepted synthetic Telegram transport: atomic offset
rollback, retry/replay, uncertain recovery, private/group distinction, shared preview/final report,
one edited acknowledgement, callback ownership, 429 and webhook secret/commit behavior. Strict
build and unit checks cover HTML/callback bounds and no-offset advancement on storage failure.
`npm run check` passes 145 unit tests and full builds; `npm run test:integration` passes 15 tests.
The read-only live diagnostic reports missing local token, with no external call attempted.

Official references: [Telegram Bot API](https://core.telegram.org/bots/api),
[grammY polling/webhooks](https://grammy.dev/guide/deployment-types), consulted 2026-10-09.
Continue stage 11: linked persistent watches and notifications.

# Stage 11 — linked watchlists and alerts

Local verification uses isolated PostgreSQL schemas, Redis and intercepted Telegram transports.
No synthetic report is reachable in production.

Browser linking uses an expiring device flow, an HttpOnly browser nonce, explicit approval by the
Telegram user in a private chat, and a single-use completion transaction. The user compares the
six-digit code with their own browser before approving. Session tokens are hashed at rest; cookies
are HttpOnly, SameSite=Lax and Secure with __Host names in production. Authenticated mutations
require the exact frontend Origin and the session CSRF value. Responses containing personal data
are private/no-store. Sessions expire after 30 days; unlink revokes all website sessions.

Website and bot read the same capped watch records and preferences. User deletion removes
subscriptions, sessions, identity, pending alerts and private scan-message bindings; public
blockchain reports remain. Telegram username must match getMe at startup.

The worker reserves monitor-lane jobs, bounded to five admissions per scheduler tick. Queue
saturation reschedules rather than discarding subscriptions. Reports are compared against each
watch's own baseline. Partial/stale/incompatible pairs and ranking changes create no alert.
Position thresholds are bps of circulating eligible supply, using bigint. A balance change only
says sale when decoded swap evidence exists. Risk changes require eligible scores with identical
rule versions. Failed checks never become a clean observation.

Pending alerts coalesce per watch, preserving an observation count and the ten most recent
change lines. Delivery batches up to twenty tokens, respects a per-user cadence and fixed-UTC
quiet hours, and shows that summaries are bounded. A 429 reschedules with Telegram retry_after;
a blocked bot pauses monitoring and delivery until the user enables it again. Ambiguous sends
and crashed sending leases become uncertain rather than automatically duplicating a message.

Configure TELEGRAM_BOT_USERNAME alongside the existing token. Frontend and API must be on the
same site for SameSite cookies; the production proxy serves both on one HTTPS origin.
Live linking and notification delivery remain pending real local credentials and user-triggered
interaction. Visual acceptance waits for design.md.

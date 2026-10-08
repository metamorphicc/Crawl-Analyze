CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE token_identities (
  mint text PRIMARY KEY, identity jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scan_jobs (
  id uuid PRIMARY KEY, mint text NOT NULL, mode text NOT NULL CHECK(mode IN ('preview','deep')),
  state text NOT NULL CHECK(state IN ('queued','running','complete','partial','failed','cancelled')),
  dedupe_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
  finished_at timestamptz, heartbeat_at timestamptz, deadline_at timestamptz,
  attempt integer NOT NULL DEFAULT 0, error_code text, report_id uuid,
  CHECK(attempt >= 0)
);
CREATE UNIQUE INDEX scan_jobs_active ON scan_jobs(dedupe_key) WHERE state IN ('queued','running');
CREATE INDEX scan_jobs_pending ON scan_jobs(state,created_at);
CREATE TABLE scan_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES scan_jobs(id), kind text NOT NULL, data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_events_replay ON scan_events(job_id,id);
CREATE TABLE reports (
  id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES scan_jobs(id), mint text NOT NULL,
  contract_version text NOT NULL, analysis_version text NOT NULL, parser_version text NOT NULL,
  body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_mint_time ON reports(mint,created_at DESC);
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_report_fk FOREIGN KEY(report_id) REFERENCES reports(id);
CREATE TABLE telegram_identities (
  user_id bigint PRIMARY KEY, private_chat_id bigint, settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES telegram_identities(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE watches (
  id uuid PRIMARY KEY, user_id bigint NOT NULL REFERENCES telegram_identities(user_id) ON DELETE CASCADE,
  mint text NOT NULL, last_report_id uuid REFERENCES reports(id), next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,mint)
);
CREATE INDEX watches_due ON watches(next_check_at);
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY, user_id bigint NOT NULL REFERENCES telegram_identities(user_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE, payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','uncertain','failed')),
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_outbox_due ON notification_outbox(state,next_attempt_at);
CREATE TABLE provider_usage (
  provider text NOT NULL, day date NOT NULL, requests bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(provider,day)
);
CREATE TABLE token_outcomes (
  report_id uuid NOT NULL REFERENCES reports(id), horizon_seconds integer NOT NULL,
  due_at timestamptz NOT NULL, observed_at timestamptz, result jsonb,
  PRIMARY KEY(report_id,horizon_seconds)
);

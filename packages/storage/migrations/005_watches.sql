ALTER TABLE sessions ADD COLUMN csrf_token text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','');
ALTER TABLE telegram_identities ADD COLUMN notification_pause_reason text;
ALTER TABLE watches ADD COLUMN pending_job_id uuid REFERENCES scan_jobs(id);
ALTER TABLE watches ADD COLUMN last_check_at timestamptz;
ALTER TABLE watches ADD COLUMN last_delivery_at timestamptz;
ALTER TABLE notification_outbox ADD COLUMN watch_id uuid REFERENCES watches(id) ON DELETE CASCADE;
ALTER TABLE notification_outbox ADD COLUMN report_id uuid REFERENCES reports(id);
ALTER TABLE notification_outbox ADD COLUMN lease_token uuid;
CREATE TABLE telegram_links (
  id uuid PRIMARY KEY, browser_hash text NOT NULL, display_code text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','requested','approved','consumed')),
  approver_id bigint REFERENCES telegram_identities(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_links_expiry ON telegram_links(expires_at);
CREATE UNIQUE INDEX notification_pending_watch ON notification_outbox(watch_id) WHERE state='pending';

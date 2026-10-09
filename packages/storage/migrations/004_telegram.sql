CREATE TABLE telegram_updates (
  id bigint PRIMARY KEY, body jsonb NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','done','uncertain','failed')),
  lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), error_code text
);
CREATE INDEX telegram_updates_due ON telegram_updates(state,next_at);
CREATE TABLE telegram_scan_messages (
  id uuid PRIMARY KEY, update_id bigint NOT NULL UNIQUE REFERENCES telegram_updates(id),
  user_id bigint NOT NULL, chat_id bigint NOT NULL, thread_id integer, job_id uuid NOT NULL REFERENCES scan_jobs(id),
  message_id integer, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','ready','done','uncertain','failed')),
  last_digest text, next_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_scan_messages_due ON telegram_scan_messages(state,next_at);
CREATE TABLE telegram_cooldowns (key text PRIMARY KEY, until_at timestamptz NOT NULL);
CREATE TABLE telegram_poll_offset (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), next_offset bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

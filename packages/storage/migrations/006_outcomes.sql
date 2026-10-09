CREATE TABLE outcome_baselines (
  report_id uuid PRIMARY KEY REFERENCES reports(id), policy_version text NOT NULL,
  observation jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE token_outcomes ADD COLUMN policy_version text NOT NULL DEFAULT 'forward-1';
CREATE INDEX token_outcomes_due ON token_outcomes(due_at) WHERE observed_at IS NULL;

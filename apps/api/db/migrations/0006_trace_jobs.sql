-- ChainSight v1.1 §7.11 — Tracer Agent job persistence
--
-- Records every trace job for audit + idempotency. Provider response hashes
-- are stored so the Reproducibility Pack verifier can replay the trace
-- against cached responses and confirm byte-identical output.

CREATE TABLE IF NOT EXISTS belief.trace_jobs (
  id                       uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  case_id                  uuid NOT NULL,
  initiated_by_id          uuid NOT NULL,
  mode                     text NOT NULL,
  origin                   text[] NOT NULL,
  direction                text NOT NULL DEFAULT 'forward',
  methodology              text NOT NULL DEFAULT 'fifo',
  params                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key          text NOT NULL,
  status                   text NOT NULL DEFAULT 'queued',  -- queued|running|completed|cancelled|failed
  queued_at                timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  completed_at             timestamptz,
  cancelled_at             timestamptz,
  total_hops               int NOT NULL DEFAULT 0,
  total_atoms_emitted      int NOT NULL DEFAULT 0,
  total_budget_spent_usd   numeric(12, 4) NOT NULL DEFAULT 0,
  provider_response_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  termination_reason       text,
  error                    text,
  UNIQUE (case_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS trace_jobs_case_idx
  ON belief.trace_jobs (case_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS trace_jobs_status_idx
  ON belief.trace_jobs (status, queued_at DESC);

-- RLS
ALTER TABLE belief.trace_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trace_jobs_read  ON belief.trace_jobs;
DROP POLICY IF EXISTS trace_jobs_write ON belief.trace_jobs;

CREATE POLICY trace_jobs_read ON belief.trace_jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl ca
      WHERE ca.case_id = belief.trace_jobs.case_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY trace_jobs_write ON belief.trace_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE belief.trace_jobs IS 'Tracer Agent jobs (v1.1 §7.11). Idempotent on (case_id, idempotency_key).';

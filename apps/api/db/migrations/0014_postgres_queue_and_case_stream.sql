-- 0014: replace Redis (BullMQ queue + pub/sub) with Postgres.
--
-- ChainSight used Redis for three things: the API-to-worker job queue
-- (BullMQ), live event fan-out to SSE clients (pub/sub), and caches. This
-- migration covers the first two so a deployment needs only Postgres:
--
--   * trace_jobs becomes the queue. The worker claims the oldest queued job
--     with FOR UPDATE SKIP LOCKED (safe with any number of workers), keeps a
--     heartbeat while it runs, and stale jobs are re-queued or failed.
--   * case_stream holds live events (trace progress, graph updates, belief
--     events). Publishers insert rows; the SSE route reads rows newer than
--     the last id it sent. Rows older than 24 hours are pruned.
--
-- Caches move to process memory or the existing belief.cache_entries table
-- (application change, no schema needed).

/* ─── trace_jobs as a queue ──────────────────────────────────────────── */

ALTER TABLE belief.trace_jobs
  -- Full TraceJob the worker runs (includes agency_id, which has no column).
  -- A queued row without a payload is not claimable.
  ADD COLUMN IF NOT EXISTS job_payload  jsonb,
  ADD COLUMN IF NOT EXISTS claimed_by   text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts     int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS trace_jobs_claim_idx
  ON belief.trace_jobs (queued_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS trace_jobs_running_idx
  ON belief.trace_jobs (heartbeat_at)
  WHERE status = 'running';

/**
 * Claim one job for p_worker. Returns zero or one row.
 *
 * Before claiming, recovers jobs whose worker died: a running job with no
 * heartbeat for p_stale_after is re-queued if it has attempts left, else
 * marked failed. Cancelled jobs are never claimed.
 */
CREATE OR REPLACE FUNCTION belief.claim_trace_job(
  p_worker       text,
  p_stale_after  interval DEFAULT interval '5 minutes',
  p_max_attempts int      DEFAULT 3
)
RETURNS SETOF belief.trace_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, pg_temp
AS $$
BEGIN
  UPDATE belief.trace_jobs
     SET status = CASE WHEN attempts < p_max_attempts THEN 'queued' ELSE 'failed' END,
         error  = CASE WHEN attempts < p_max_attempts THEN error
                       ELSE 'worker stopped responding (no heartbeat) after ' || attempts || ' attempts' END,
         completed_at = CASE WHEN attempts < p_max_attempts THEN NULL ELSE now() END,
         claimed_by = NULL
   WHERE status = 'running'
     AND heartbeat_at < now() - p_stale_after;

  RETURN QUERY
  UPDATE belief.trace_jobs t
     SET status       = 'running',
         started_at   = COALESCE(t.started_at, now()),
         heartbeat_at = now(),
         claimed_by   = p_worker,
         attempts     = t.attempts + 1
   WHERE t.id = (
           SELECT id FROM belief.trace_jobs
            WHERE status = 'queued' AND job_payload IS NOT NULL
            ORDER BY queued_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
  RETURNING t.*;
END;
$$;

/** Heartbeat for a running job. Returns false if the job is no longer running (e.g. cancelled). */
CREATE OR REPLACE FUNCTION belief.heartbeat_trace_job(p_job_id uuid, p_worker text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = belief, pg_temp
AS $$
  WITH u AS (
    UPDATE belief.trace_jobs
       SET heartbeat_at = now()
     WHERE id = p_job_id AND status = 'running' AND claimed_by = p_worker
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u);
$$;

REVOKE ALL ON FUNCTION belief.claim_trace_job(text, interval, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION belief.heartbeat_trace_job(uuid, text)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION belief.claim_trace_job(text, interval, int) TO service_role;
GRANT EXECUTE ON FUNCTION belief.heartbeat_trace_job(uuid, text)      TO service_role;

/* ─── case_stream: live events ───────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.case_stream (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     uuid NOT NULL,
  -- Event family the SSE route uses as the event name:
  -- 'trace' | 'graph-updated' | 'inspector' | 'beliefs'
  topic       text NOT NULL,
  -- Sub-key within the topic (trace job id, inspector tx, ...). Nullable.
  topic_key   text,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_stream_case_id_idx ON belief.case_stream (case_id, id);
CREATE INDEX IF NOT EXISTS case_stream_topic_id_idx ON belief.case_stream (topic, id);
CREATE INDEX IF NOT EXISTS case_stream_created_idx ON belief.case_stream (created_at);

ALTER TABLE belief.case_stream ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (API + worker) reads or writes it.

GRANT SELECT, INSERT, DELETE ON belief.case_stream TO service_role;

/** Delete stream rows older than p_keep. Called periodically by the worker. */
CREATE OR REPLACE FUNCTION belief.prune_case_stream(p_keep interval DEFAULT interval '24 hours')
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = belief, pg_temp
AS $$
  WITH d AS (DELETE FROM belief.case_stream WHERE created_at < now() - p_keep RETURNING 1)
  SELECT count(*) FROM d;
$$;

REVOKE ALL ON FUNCTION belief.prune_case_stream(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION belief.prune_case_stream(interval) TO service_role;

COMMENT ON TABLE belief.case_stream IS 'Live case events for SSE (replaces Redis pub/sub). Pruned after 24h; durable history lives in belief.events.';

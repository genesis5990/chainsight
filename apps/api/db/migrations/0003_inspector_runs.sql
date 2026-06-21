-- ChainSight v1.1 §5.8 — Inspector Run persistence
-- Stores the 8-section output of an Inspector run, recipe hash bundle,
-- and the IDs of belief atoms emitted during the run. 30-day TTL is enforced
-- by a periodic cleanup job (see ops/cleanup_inspector_runs.sql).
-- All inspector_run rows are subject to case_acl RLS via case_id.

CREATE TABLE IF NOT EXISTS belief.inspector_runs (
  id                     uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  case_id                uuid NOT NULL,
  tx_ref                 text NOT NULL,
  methodology            text NOT NULL,
  ran_at                 timestamptz NOT NULL DEFAULT now(),
  ran_by_id              uuid NOT NULL,

  -- 8 sections — nullable so partial runs (failure mid-pipeline) still persist
  section_header         jsonb,
  section_parties        jsonb,
  section_decoded        jsonb,
  section_value_fees     jsonb,
  section_methodology    jsonb,
  section_attribution    jsonb,
  section_narrative      jsonb,
  section_citations      jsonb,

  -- Reproducibility envelope: { math: {...recipe hashes...}, llm_prompt_hash, chain_provider_fingerprint }
  recipe_hash_bundle     jsonb NOT NULL,

  -- Deterministic cache key (BLAKE3 of tx_ref + methodology + recipe_hash_bundle.math.*)
  cache_key              text NOT NULL,

  -- Belief atoms emitted by this run (foreign-ref by id; not enforced FK to allow cleanup ordering)
  emitted_atom_ids       uuid[] NOT NULL DEFAULT '{}',

  -- TTL marker: rows older than 30 days are eligible for deletion
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS inspector_runs_tx_idx
  ON belief.inspector_runs (tx_ref, methodology);

CREATE INDEX IF NOT EXISTS inspector_runs_case_idx
  ON belief.inspector_runs (case_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS inspector_runs_cache_idx
  ON belief.inspector_runs (cache_key);

CREATE INDEX IF NOT EXISTS inspector_runs_expires_idx
  ON belief.inspector_runs (expires_at);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE belief.inspector_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspector_runs_read  ON belief.inspector_runs;
DROP POLICY IF EXISTS inspector_runs_write ON belief.inspector_runs;

-- Read: any case_acl member can read inspector runs for their case
CREATE POLICY inspector_runs_read ON belief.inspector_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl ca
      WHERE ca.case_id = belief.inspector_runs.case_id
        AND ca.user_id = auth.uid()
    )
  );

-- Write: only the service role inserts (worker uses service-role key)
CREATE POLICY inspector_runs_write ON belief.inspector_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE  belief.inspector_runs           IS 'Per-tx Inspector pipeline outputs (v1.1 §5.8). 30-day TTL via expires_at.';
COMMENT ON COLUMN belief.inspector_runs.cache_key IS 'BLAKE3 of (tx_ref, methodology, math recipe hashes) — used for idempotent re-runs.';
COMMENT ON COLUMN belief.inspector_runs.recipe_hash_bundle IS 'Reproducibility envelope: {math:{...}, llm_prompt_hash, chain_provider_fingerprint}.';

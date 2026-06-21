-- ChainSight v1.0 Backend §8 — Capability Router persistence
--
-- Three tables:
--   1. belief.agency_provider_installs — which providers an agency has wired up
--   2. belief.cache_entries            — L2 cache for capability results
--   3. belief.provider_resolutions     — audit log for every router call

/* ─── 1. agency_provider_installs ─────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.agency_provider_installs (
  id                    uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  agency_id             text NOT NULL,                -- '*' for default
  provider_id           text NOT NULL,                -- 'etherscan', 'anthropic', etc
  enabled_capabilities  text[] NOT NULL DEFAULT '{}',
  priority              int NOT NULL DEFAULT 100,
  credential_ref        text,                         -- env-var name (Phase 1) / vault key (Phase 2)
  enabled               boolean NOT NULL DEFAULT true,
  case_id               uuid,                         -- null = agency-wide
  budget_usd_per_month  numeric,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agency_provider_installs_lookup_idx
  ON belief.agency_provider_installs (agency_id, enabled, priority);

CREATE INDEX IF NOT EXISTS agency_provider_installs_caps_idx
  ON belief.agency_provider_installs USING GIN (enabled_capabilities);

ALTER TABLE belief.agency_provider_installs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_provider_installs_read  ON belief.agency_provider_installs;
DROP POLICY IF EXISTS agency_provider_installs_write ON belief.agency_provider_installs;

-- Read: members of the agency, plus '*' default rows (visible to everyone).
-- For Phase 1 we only enforce the catch-all read; tightening to per-agency
-- agency membership comes when the agencies table is added.
CREATE POLICY agency_provider_installs_read ON belief.agency_provider_installs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY agency_provider_installs_write ON belief.agency_provider_installs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

/* ─── 2. cache_entries ────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.cache_entries (
  cache_key             text NOT NULL,
  scope                 text NOT NULL CHECK (scope IN ('global_chain_data', 'agency', 'case')),
  scope_ref             text NOT NULL DEFAULT '_',
  payload               jsonb NOT NULL,
  provider_install_id   uuid,
  provider_id           text,
  fetched_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  ttl_tier              text NOT NULL,
  hit_count             int NOT NULL DEFAULT 0,
  byte_size             int NOT NULL DEFAULT 0,
  PRIMARY KEY (cache_key, scope, scope_ref)
);

CREATE INDEX IF NOT EXISTS cache_entries_expires_idx ON belief.cache_entries (expires_at);
CREATE INDEX IF NOT EXISTS cache_entries_scope_idx   ON belief.cache_entries (scope, scope_ref);

ALTER TABLE belief.cache_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cache_entries_read  ON belief.cache_entries;
DROP POLICY IF EXISTS cache_entries_write ON belief.cache_entries;

-- Read: global_chain_data is shared across agencies; agency/case scoped rows
-- are read only by the matching agency_id / case_acl. For Phase 1 we keep
-- this permissive (auth required) and tighten in a follow-up once the
-- agencies table exists.
CREATE POLICY cache_entries_read ON belief.cache_entries
  FOR SELECT TO authenticated
  USING (
    scope = 'global_chain_data'
    OR (
      scope = 'case'
      AND EXISTS (
        SELECT 1 FROM belief.case_acl ca
        WHERE ca.case_id::text = belief.cache_entries.scope_ref
          AND ca.user_id = auth.uid()
      )
    )
    OR scope = 'agency'   -- TODO(phase-2): restrict to agency members
  );

CREATE POLICY cache_entries_write ON belief.cache_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

/* ─── 3. provider_resolutions (audit) ─────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.provider_resolutions (
  id                     uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  agency_id              text NOT NULL,
  case_id                uuid,
  capability             text NOT NULL,
  provider_install_id    uuid,
  provider_id            text,
  cache_hit              boolean NOT NULL DEFAULT false,
  latency_ms             int,
  error                  text,
  resolved_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_resolutions_audit_idx
  ON belief.provider_resolutions (agency_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS provider_resolutions_case_idx
  ON belief.provider_resolutions (case_id, resolved_at DESC);

ALTER TABLE belief.provider_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_resolutions_read  ON belief.provider_resolutions;
DROP POLICY IF EXISTS provider_resolutions_write ON belief.provider_resolutions;

CREATE POLICY provider_resolutions_read ON belief.provider_resolutions
  FOR SELECT TO authenticated
  USING (
    case_id IS NULL
    OR EXISTS (
      SELECT 1 FROM belief.case_acl ca
      WHERE ca.case_id = belief.provider_resolutions.case_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY provider_resolutions_write ON belief.provider_resolutions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

/* ─── Comments ────────────────────────────────────────────────────────── */

COMMENT ON TABLE belief.agency_provider_installs IS 'Capability Router install rows (v1.0 Backend §8). agency_id = ''*'' means default for every agency.';
COMMENT ON TABLE belief.cache_entries            IS 'L2 cache for capability results. Phase 1 stores plain JSON; Phase 2 will encrypt per-agency.';
COMMENT ON TABLE belief.provider_resolutions     IS 'Audit log for every router call. F32 / G16 compliance.';

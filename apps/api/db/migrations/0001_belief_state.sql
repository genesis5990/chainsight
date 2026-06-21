-- ============================================================================
-- Migration 0001 — Belief State Service v1.1 foundation
-- Spec: docs/chainsight_v1_1_technical_core_spec.md §3 + §2.2
-- ============================================================================
--
-- IMPORTANT: This migration creates the v1.1 Belief State in a dedicated
-- `belief` schema to avoid colliding with the legacy v0.x `public.belief_atoms`
-- table. The legacy table will be deprecated in a later migration once all
-- callers have migrated. Until then, both schemas coexist.
--
-- All tables, indexes, and policies are idempotent on re-apply.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS belief;

-- ─── uuid v7 helper (in belief schema to avoid collision) ───────────────────
CREATE OR REPLACE FUNCTION belief.gen_uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ts_ms bigint;
  rand_bytes bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rand_bytes := gen_random_bytes(10);
  uuid_bytes := decode(lpad(to_hex(unix_ts_ms), 12, '0'), 'hex') || rand_bytes;
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & x'0f'::int) | x'70'::int);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & x'3f'::int) | x'80'::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

-- ─── case_acl (in belief schema; FK to public.cases for tenant join) ────────
-- We do not duplicate the existing public.cases table. Instead, the belief
-- ACL references it. The legacy v0.x case schema has a `cases.id uuid PK` so
-- the join works.
CREATE TABLE IF NOT EXISTS belief.case_acl (
  case_id     uuid NOT NULL,
  user_id     uuid NOT NULL,
  can_read    boolean NOT NULL DEFAULT true,
  can_write   boolean NOT NULL DEFAULT false,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid NOT NULL,
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX IF NOT EXISTS case_acl_user_idx ON belief.case_acl (user_id);

-- ─── belief.atoms — present-state of every claim ────────────────────────────
CREATE TABLE IF NOT EXISTS belief.atoms (
  id                     uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  case_id                uuid NOT NULL,
  subject_ref            text NOT NULL,
  subject_kind           text NOT NULL CHECK (subject_kind IN ('address','tx','cluster')),
  predicate              text NOT NULL,
  object_payload         jsonb NOT NULL,
  basis                  text NOT NULL CHECK (basis IN ('T0','T2','T3')),
  basis_detail           text NOT NULL,
  confidence             jsonb NOT NULL,
  supporting_evidence    jsonb NOT NULL DEFAULT '[]'::jsonb,
  emitted_by_kind        text NOT NULL CHECK (emitted_by_kind IN ('human','agent','system')),
  emitted_by_id          uuid NOT NULL,
  emitted_at             timestamptz NOT NULL DEFAULT now(),
  parent_atom_id         uuid REFERENCES belief.atoms(id),
  reproducibility_inputs jsonb,
  status                 text NOT NULL DEFAULT 'asserted'
                           CHECK (status IN ('asserted','challenged','superseded','retracted')),
  superseded_by          uuid REFERENCES belief.atoms(id),
  superseded_at          timestamptz,
  payload_hash           bytea NOT NULL,
  locked_at              timestamptz,
  locked_in_pack_id      uuid
);

CREATE INDEX IF NOT EXISTS atoms_case_idx
  ON belief.atoms (case_id, emitted_at DESC);
CREATE INDEX IF NOT EXISTS atoms_subject_idx
  ON belief.atoms (case_id, subject_kind, subject_ref);
CREATE INDEX IF NOT EXISTS atoms_predicate_idx
  ON belief.atoms (case_id, predicate);
CREATE INDEX IF NOT EXISTS atoms_status_idx
  ON belief.atoms (case_id, status)
  WHERE status IN ('asserted','challenged');
CREATE INDEX IF NOT EXISTS atoms_pack_idx
  ON belief.atoms (locked_in_pack_id)
  WHERE locked_in_pack_id IS NOT NULL;

-- ─── challenges ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS belief.atom_challenges (
  id              uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  atom_id         uuid NOT NULL REFERENCES belief.atoms(id),
  case_id         uuid NOT NULL,
  reason          text NOT NULL,
  challenged_by   uuid NOT NULL,
  challenged_at   timestamptz NOT NULL DEFAULT now(),
  resolution      text CHECK (resolution IN ('upheld','superseded','withdrawn')),
  resolution_note text,
  resolved_by     uuid,
  resolved_at     timestamptz
);
CREATE INDEX IF NOT EXISTS atom_challenges_atom_idx
  ON belief.atom_challenges (atom_id);
CREATE INDEX IF NOT EXISTS atom_challenges_open_idx
  ON belief.atom_challenges (case_id)
  WHERE resolved_at IS NULL;

-- ─── retractions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS belief.atom_retractions (
  id            uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  atom_id       uuid NOT NULL REFERENCES belief.atoms(id),
  case_id       uuid NOT NULL,
  reason        text NOT NULL,
  retracted_by  uuid NOT NULL,
  retracted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS atom_retractions_atom_idx
  ON belief.atom_retractions (atom_id);

-- ─── per-case event log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS belief.case_event_seq (
  case_id  uuid PRIMARY KEY,
  next_seq bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS belief.events (
  id          uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  case_id     uuid NOT NULL,
  kind        text NOT NULL,
  payload     jsonb NOT NULL,
  emitted_at  timestamptz NOT NULL DEFAULT now(),
  case_seq    bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_case_seq_unique
  ON belief.events (case_id, case_seq);
CREATE INDEX IF NOT EXISTS events_case_emitted_idx
  ON belief.events (case_id, emitted_at DESC);

-- ─── idempotency records ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS belief.idempotency_records (
  key            text PRIMARY KEY,
  actor_id       uuid NOT NULL,
  endpoint       text NOT NULL,
  input_hash     bytea NOT NULL,
  result_payload jsonb NOT NULL,
  status         text NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS idempotency_records_expires_idx
  ON belief.idempotency_records (expires_at);

-- ─── Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE belief.atoms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.atom_challenges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.atom_retractions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.case_acl          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atoms_read              ON belief.atoms;
DROP POLICY IF EXISTS atoms_write             ON belief.atoms;
DROP POLICY IF EXISTS atoms_update_unlocked   ON belief.atoms;
DROP POLICY IF EXISTS events_read             ON belief.events;
DROP POLICY IF EXISTS challenges_read         ON belief.atom_challenges;
DROP POLICY IF EXISTS challenges_write        ON belief.atom_challenges;
DROP POLICY IF EXISTS retractions_read        ON belief.atom_retractions;
DROP POLICY IF EXISTS retractions_write       ON belief.atom_retractions;
DROP POLICY IF EXISTS case_acl_read           ON belief.case_acl;

CREATE POLICY atoms_read ON belief.atoms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id  = belief.atoms.case_id
         AND c.user_id  = auth.uid()
         AND c.can_read = true
    )
  );

CREATE POLICY atoms_write ON belief.atoms FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id   = belief.atoms.case_id
         AND c.user_id   = auth.uid()
         AND c.can_write = true
    )
  );

CREATE POLICY atoms_update_unlocked ON belief.atoms FOR UPDATE
  USING (locked_at IS NULL)
  WITH CHECK (locked_at IS NULL);

CREATE POLICY events_read ON belief.events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id  = belief.events.case_id
         AND c.user_id  = auth.uid()
         AND c.can_read = true
    )
  );

CREATE POLICY challenges_read ON belief.atom_challenges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id  = belief.atom_challenges.case_id
         AND c.user_id  = auth.uid()
         AND c.can_read = true
    )
  );

CREATE POLICY challenges_write ON belief.atom_challenges FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id   = belief.atom_challenges.case_id
         AND c.user_id   = auth.uid()
         AND c.can_write = true
    )
  );

CREATE POLICY retractions_read ON belief.atom_retractions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id  = belief.atom_retractions.case_id
         AND c.user_id  = auth.uid()
         AND c.can_read = true
    )
  );

CREATE POLICY retractions_write ON belief.atom_retractions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM belief.case_acl c
       WHERE c.case_id   = belief.atom_retractions.case_id
         AND c.user_id   = auth.uid()
         AND c.can_write = true
    )
  );

CREATE POLICY case_acl_read ON belief.case_acl FOR SELECT
  USING (user_id = auth.uid());

-- ─── Service-role grants ────────────────────────────────────────────────────
-- The worker uses the service_role key (bypasses RLS). For human-facing API
-- calls hitting the schema directly via PostgREST, expose only safe roles.
GRANT USAGE ON SCHEMA belief TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA belief TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA belief TO authenticated;

COMMENT ON SCHEMA belief                  IS 'Phase-1 Belief State Service v1.1.';
COMMENT ON TABLE  belief.atoms            IS 'Present-state of every claim. v1.1 §3.2.';
COMMENT ON TABLE  belief.events           IS 'Append-only event log for replay + canvas streaming. v1.1 §3.3.';
COMMENT ON TABLE  belief.idempotency_records IS 'Request-fingerprint cache for safe retries. v1.1 §2.2.';

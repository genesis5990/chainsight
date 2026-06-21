-- ChainSight v1.0 Backend §1.8 — Reproducibility Pack persistence
--
-- A Reproducibility Pack snapshots a case at finalization. The manifest hash
-- is the content-address of the pack: identical inputs produce byte-identical
-- bytes. Atoms referenced in a finalized pack are locked (G5 immutability).

CREATE TABLE IF NOT EXISTS belief.reproducibility_packs (
  id                 uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  case_id            uuid NOT NULL,
  built_by_id        uuid NOT NULL,
  agency_id          text NOT NULL,
  manifest_hash      text NOT NULL,
  storage_ref        text,                              -- e.g. supabase://repro-packs/{agency}/{case}/{pack}.zip
  status             text NOT NULL DEFAULT 'building',  -- building|finalized|failed
  built_at           timestamptz NOT NULL DEFAULT now(),
  finalized_at       timestamptz,
  signed_at          timestamptz,
  signer_id          uuid,
  total_atoms        int NOT NULL DEFAULT 0,
  total_traces       int NOT NULL DEFAULT 0,
  total_events       int NOT NULL DEFAULT 0,
  /** Hash chain tip — sha256 of the last event in the case at build time. */
  chain_tip_hash     text,
  /** Sigstore signature or null. */
  signature          text,
  manifest_size_bytes int,
  error              text,
  UNIQUE (case_id, manifest_hash)
);

CREATE INDEX IF NOT EXISTS reproducibility_packs_case_idx
  ON belief.reproducibility_packs (case_id, built_at DESC);
CREATE INDEX IF NOT EXISTS reproducibility_packs_status_idx
  ON belief.reproducibility_packs (status, built_at DESC);

ALTER TABLE belief.reproducibility_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reproducibility_packs_read  ON belief.reproducibility_packs;
DROP POLICY IF EXISTS reproducibility_packs_write ON belief.reproducibility_packs;

CREATE POLICY reproducibility_packs_read ON belief.reproducibility_packs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl ca
      WHERE ca.case_id = belief.reproducibility_packs.case_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY reproducibility_packs_write ON belief.reproducibility_packs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Atom locking function ──────────────────────────────────────────────
-- SECURITY DEFINER so the worker (service_role) can flip locked_in_pack_id
-- on all unlocked atoms in a case during pack finalization. Idempotent:
-- atoms already locked by a different pack are left alone.
CREATE OR REPLACE FUNCTION belief.lock_atoms_in_pack(
  p_pack_id uuid,
  p_case_id uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, pg_temp
AS $$
DECLARE
  v_locked_count int;
BEGIN
  UPDATE belief.atoms
     SET locked_in_pack_id = p_pack_id
   WHERE case_id = p_case_id
     AND locked_in_pack_id IS NULL;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  RETURN v_locked_count;
END;
$$;

REVOKE ALL ON FUNCTION belief.lock_atoms_in_pack(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.lock_atoms_in_pack(uuid, uuid) TO service_role;

COMMENT ON TABLE belief.reproducibility_packs IS 'Reproducibility Pack manifests (v1.0 Backend §1.8). Pack bytes live in storage_ref.';
COMMENT ON FUNCTION belief.lock_atoms_in_pack IS 'Idempotent atom locker — flips locked_in_pack_id on all unlocked atoms in a case.';

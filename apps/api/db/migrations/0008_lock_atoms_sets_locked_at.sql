-- Phase-1 acceptance fix: lock_atoms_in_pack must also set locked_at.
--
-- The belief-state service guard at
--   packages/belief-state/src/service.ts (challenge/supersede/retract)
-- checks `atom.locked_at` to enforce G5 immutability. The original
-- lock_atoms_in_pack only set locked_in_pack_id, leaving locked_at NULL
-- and silently bypassing the guard. This migration fixes the function and
-- backfills any rows that were locked under the bug.

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
     SET locked_in_pack_id = p_pack_id,
         locked_at = COALESCE(locked_at, now())
   WHERE case_id = p_case_id
     AND locked_in_pack_id IS NULL;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  RETURN v_locked_count;
END;
$$;

REVOKE ALL ON FUNCTION belief.lock_atoms_in_pack(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.lock_atoms_in_pack(uuid, uuid) TO service_role;

-- Backfill rows locked before this migration.
UPDATE belief.atoms
   SET locked_at = COALESCE(locked_at, now())
 WHERE locked_in_pack_id IS NOT NULL
   AND locked_at IS NULL;

COMMENT ON FUNCTION belief.lock_atoms_in_pack IS 'Idempotent atom locker — sets both locked_in_pack_id and locked_at so the application-layer G5 guard fires.';

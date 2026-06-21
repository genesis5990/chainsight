-- ============================================================================
-- Migration 0002 — Belief State Service v1.1 server-side functions
-- ============================================================================
-- Two functions:
--   1. belief.bump_case_seq(case_id) — atomically returns the next case_seq
--   2. belief.insert_atom_with_event(...) — single-txn insert of atom + event
--
-- Both functions are SECURITY DEFINER and must be called only via the
-- service_role (worker) or via RLS-vetted authenticated path.

-- ─── bump_case_seq ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION belief.bump_case_seq(p_case_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, pg_temp
AS $$
DECLARE
  v_seq bigint;
BEGIN
  INSERT INTO belief.case_event_seq (case_id, next_seq)
    VALUES (p_case_id, 2)
    ON CONFLICT (case_id) DO UPDATE
      SET next_seq = belief.case_event_seq.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END;
$$;
REVOKE ALL ON FUNCTION belief.bump_case_seq(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.bump_case_seq(uuid) TO service_role;

-- ─── insert_atom_with_event ─────────────────────────────────────────────────
-- Inserts a new BeliefAtom row, advances the per-case sequence, and writes
-- an 'atom_emitted' event row — all in one server-side transaction.
--
-- Returns a JSONB with two keys:
--   - atom: the inserted row (selected back to capture defaults)
--   - case_seq: the sequence number stamped on the event row
CREATE OR REPLACE FUNCTION belief.insert_atom_with_event(
  p_case_id                uuid,
  p_subject_ref            text,
  p_subject_kind           text,
  p_predicate              text,
  p_object_payload         jsonb,
  p_basis                  text,
  p_basis_detail           text,
  p_confidence             jsonb,
  p_supporting_evidence    jsonb,
  p_emitted_by_kind        text,
  p_emitted_by_id          uuid,
  p_parent_atom_id         uuid,
  p_reproducibility_inputs jsonb,
  p_payload_hash           bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, pg_temp
AS $$
DECLARE
  v_atom belief.atoms%ROWTYPE;
  v_case_seq bigint;
BEGIN
  -- 1. insert the atom
  INSERT INTO belief.atoms (
    case_id, subject_ref, subject_kind, predicate, object_payload,
    basis, basis_detail, confidence, supporting_evidence,
    emitted_by_kind, emitted_by_id, parent_atom_id,
    reproducibility_inputs, payload_hash
  ) VALUES (
    p_case_id, p_subject_ref, p_subject_kind, p_predicate, p_object_payload,
    p_basis, p_basis_detail, p_confidence, COALESCE(p_supporting_evidence, '[]'::jsonb),
    p_emitted_by_kind, p_emitted_by_id, p_parent_atom_id,
    p_reproducibility_inputs, p_payload_hash
  )
  RETURNING * INTO v_atom;

  -- 2. bump per-case sequence
  INSERT INTO belief.case_event_seq (case_id, next_seq)
    VALUES (p_case_id, 2)
    ON CONFLICT (case_id) DO UPDATE
      SET next_seq = belief.case_event_seq.next_seq + 1
    RETURNING next_seq - 1 INTO v_case_seq;

  -- 3. write event
  INSERT INTO belief.events (case_id, kind, payload, case_seq)
  VALUES (
    p_case_id,
    'atom_emitted',
    jsonb_build_object(
      'kind', 'atom_emitted',
      'case_seq', v_case_seq,
      'atom', to_jsonb(v_atom) || jsonb_build_object(
        'payload_hash', encode(v_atom.payload_hash, 'hex'),
        'challenges', '[]'::jsonb
      )
    ),
    v_case_seq
  );

  -- 4. return the inserted atom + seq for the caller to publish.
  RETURN jsonb_build_object(
    'atom', to_jsonb(v_atom) || jsonb_build_object(
      'payload_hash', encode(v_atom.payload_hash, 'hex')
    ),
    'case_seq', v_case_seq
  );
END;
$$;
REVOKE ALL ON FUNCTION belief.insert_atom_with_event(uuid, text, text, text, jsonb, text, text, jsonb, jsonb, text, uuid, uuid, jsonb, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.insert_atom_with_event(uuid, text, text, text, jsonb, text, text, jsonb, jsonb, text, uuid, uuid, jsonb, bytea) TO service_role;

COMMENT ON FUNCTION belief.bump_case_seq             IS 'Atomically advance per-case event sequence. v1.1 §3.3.';
COMMENT ON FUNCTION belief.insert_atom_with_event    IS 'Single-txn insert of atom + atom_emitted event. v1.1 §3.6.';

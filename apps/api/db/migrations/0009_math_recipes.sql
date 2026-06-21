-- ============================================================================
-- Migration 0009 — belief.math_recipes (frozen math service recipes)
-- Spec: v1.1 §7 Reproducibility Pack — math recipes section
-- ============================================================================
-- The math service ("Pillar 1") freezes every numerical computation into a
-- canonical recipe. Atoms reference these recipes by hash inside
-- reproducibility_inputs.recipe_hash. The pack builder collects them for the
-- "math_recipes" manifest section so verifiers can rebuild byte-identical
-- outputs without re-running the math service.
--
-- For Phase-1 we only persisted the hash inside atom.reproducibility_inputs.
-- Phase-2 promotes the recipe to its own table so the pack can carry the
-- frozen inputs + outputs deterministically.

CREATE TABLE IF NOT EXISTS belief.math_recipes (
  recipe_hash    text PRIMARY KEY,
  case_id        uuid NOT NULL,
  rpc            text NOT NULL,
  algo_version   text NOT NULL,
  inputs         jsonb NOT NULL,
  output         jsonb NOT NULL,
  emitted_at     timestamptz NOT NULL DEFAULT now(),
  emitted_by_id  uuid
);

CREATE INDEX IF NOT EXISTS math_recipes_case_idx
  ON belief.math_recipes (case_id, emitted_at);

-- Atoms reference recipes via reproducibility_inputs.recipe_hash. We keep
-- recipe_hash as text (not uuid) because the math service emits BLAKE3 hex.

-- RLS — same model as belief.atoms: visible to case members via case_acl.
ALTER TABLE belief.math_recipes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'belief' AND tablename = 'math_recipes' AND policyname = 'math_recipes_read'
  ) THEN
    CREATE POLICY math_recipes_read ON belief.math_recipes
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM belief.case_acl a
          WHERE a.case_id = math_recipes.case_id
            AND a.user_id = auth.uid()
            AND a.can_read = true
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'belief' AND tablename = 'math_recipes' AND policyname = 'math_recipes_write_service'
  ) THEN
    -- only service-role inserts (the inspector + tracer workers use service role)
    CREATE POLICY math_recipes_write_service ON belief.math_recipes
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Helper to upsert a recipe idempotently from worker code.
CREATE OR REPLACE FUNCTION belief.upsert_math_recipe(
  p_recipe_hash  text,
  p_case_id      uuid,
  p_rpc          text,
  p_algo_version text,
  p_inputs       jsonb,
  p_output       jsonb,
  p_emitted_by_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO belief.math_recipes (recipe_hash, case_id, rpc, algo_version, inputs, output, emitted_by_id)
  VALUES (p_recipe_hash, p_case_id, p_rpc, p_algo_version, p_inputs, p_output, p_emitted_by_id)
  ON CONFLICT (recipe_hash) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION belief.upsert_math_recipe(text, uuid, text, text, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.upsert_math_recipe(text, uuid, text, text, jsonb, jsonb, uuid) TO service_role;

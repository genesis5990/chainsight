-- ============================================================================
-- Migration 0011 — Supabase Vault-backed agency credentials
-- Spec: v1.0 Security & Sovereignty §3.2
-- ============================================================================
--
-- The Phase-2 0010 migration shipped agency_credentials with a `plain_b64`
-- fallback so dev would keep working without a vault. That was always meant
-- to be a placeholder. This migration adds the Vault path:
--
--   belief.agency_credentials.vault_secret_id (uuid) FK → vault.secrets(id)
--   cipher_algo CHECK extended to include 'vault'
--
-- + two SECURITY DEFINER helper RPCs that hide vault.* from API callers:
--
--   belief.store_agency_credential(p_agency uuid, p_provider text, p_label text,
--                                  p_secret text, p_creator uuid)
--     → uuid (credential id). Writes to vault.secrets, then a belief row that
--       references it. The API uses this from /v1/agency/:id/credentials.
--
--   belief.decrypt_agency_credential(p_credential_id uuid) → text
--     → returns the plaintext secret. Service role only (the worker's
--       VaultCredentialStore is the only intended caller).
--
-- Threat model handled here:
--   - A support engineer with service-role DB access can SELECT
--     belief.agency_credentials freely. They can see provider_id, label,
--     created_by, created_at — but the `secret_cipher` column is left empty
--     for vault-backed rows; the ciphertext lives in vault.secrets.
--   - The Vault root key never appears in any session; pgsodium-derived
--     keys live in the vault role only. Support cannot SELECT vault.secrets
--     directly (no GRANT to service_role on the underlying tables; the
--     decrypted view requires a privileged role).
--   - The only path to plaintext is the SECURITY DEFINER RPC, which we
--     audit (TODO: belief.credential_access_log in a later migration).

-- ─── 1. Schema extension ───────────────────────────────────────────────────

ALTER TABLE belief.agency_credentials
  ADD COLUMN IF NOT EXISTS vault_secret_id uuid;

-- Loosen the CHECK to allow 'vault'. Drop + recreate is idempotent enough here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'agency_credentials_cipher_algo_check'
  ) THEN
    ALTER TABLE belief.agency_credentials DROP CONSTRAINT agency_credentials_cipher_algo_check;
  END IF;
END$$;

ALTER TABLE belief.agency_credentials
  ADD CONSTRAINT agency_credentials_cipher_algo_check
  CHECK (cipher_algo IN ('vault', 'pgsodium', 'plain_b64'));

-- For vault-backed rows the secret_cipher column is empty (we store the
-- reference in vault_secret_id). Make secret_cipher nullable to support
-- this; existing plain_b64 rows still satisfy the NOT-NULL semantics by
-- writing the base64 directly. We use DEFAULT '' to keep historical inserts
-- happy.
ALTER TABLE belief.agency_credentials
  ALTER COLUMN secret_cipher DROP NOT NULL;

-- ─── 2. store_agency_credential RPC ────────────────────────────────────────

CREATE OR REPLACE FUNCTION belief.store_agency_credential(
  p_agency      uuid,
  p_provider    text,
  p_label       text,
  p_secret      text,
  p_creator     uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, vault, pg_temp
AS $$
DECLARE
  v_secret_id uuid;
  v_cred_id   uuid;
  v_name      text;
BEGIN
  -- Defensive: only members of the agency can write a credential. The API
  -- has already enforced admin; this is a belt-and-suspenders check.
  IF NOT EXISTS (
    SELECT 1 FROM belief.agency_members m
    WHERE m.agency_id = p_agency AND m.user_id = p_creator
  ) THEN
    RAISE EXCEPTION 'forbidden: not an agency member';
  END IF;

  -- Vault secret names must be globally unique. Use (agency, provider, label, random).
  v_name := format('chainsight:%s:%s:%s:%s', p_agency, p_provider, COALESCE(NULLIF(p_label, ''), 'default'), gen_random_uuid());

  -- Create the vault secret. vault.create_secret returns the new id.
  SELECT vault.create_secret(p_secret, v_name, format('agency=%s provider=%s', p_agency, p_provider)) INTO v_secret_id;

  -- Insert the belief row referencing the vault secret.
  INSERT INTO belief.agency_credentials (
    agency_id, provider_id, label, secret_cipher, cipher_algo,
    vault_secret_id, created_by
  ) VALUES (
    p_agency, p_provider, COALESCE(p_label, ''), '', 'vault',
    v_secret_id, p_creator
  ) RETURNING id INTO v_cred_id;

  RETURN v_cred_id;
END;
$$;

REVOKE ALL ON FUNCTION belief.store_agency_credential(uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.store_agency_credential(uuid, text, text, text, uuid) TO service_role;

-- ─── 3. decrypt_agency_credential RPC ──────────────────────────────────────

CREATE OR REPLACE FUNCTION belief.decrypt_agency_credential(
  p_credential_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, vault, pg_temp
AS $$
DECLARE
  v_row    belief.agency_credentials%ROWTYPE;
  v_plain  text;
BEGIN
  SELECT * INTO v_row FROM belief.agency_credentials WHERE id = p_credential_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.cipher_algo = 'vault' THEN
    IF v_row.vault_secret_id IS NULL THEN
      RAISE EXCEPTION 'vault-backed credential is missing vault_secret_id';
    END IF;
    SELECT decrypted_secret INTO v_plain FROM vault.decrypted_secrets WHERE id = v_row.vault_secret_id;
    RETURN v_plain;
  ELSIF v_row.cipher_algo = 'plain_b64' THEN
    -- Backward-compat shim for dev rows seeded under 0010. NOT for prod.
    RETURN convert_from(decode(v_row.secret_cipher, 'base64'), 'UTF8');
  ELSE
    RAISE EXCEPTION 'unsupported cipher_algo: %', v_row.cipher_algo;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION belief.decrypt_agency_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.decrypt_agency_credential(uuid) TO service_role;

-- ─── 4. Rotation helper ────────────────────────────────────────────────────
-- Re-write the underlying vault secret for an existing credential (so the
-- credential_id stays stable but the secret changes). Used during BYOK key
-- rotation in the agency-admin UI.
CREATE OR REPLACE FUNCTION belief.rotate_agency_credential(
  p_credential_id uuid,
  p_new_secret    text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, vault, pg_temp
AS $$
DECLARE
  v_row belief.agency_credentials%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM belief.agency_credentials WHERE id = p_credential_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credential not found';
  END IF;
  IF v_row.cipher_algo <> 'vault' OR v_row.vault_secret_id IS NULL THEN
    RAISE EXCEPTION 'only vault-backed credentials can be rotated via this RPC';
  END IF;
  PERFORM vault.update_secret(v_row.vault_secret_id, p_new_secret, NULL, NULL);
  UPDATE belief.agency_credentials SET rotated_at = now() WHERE id = p_credential_id;
END;
$$;

REVOKE ALL ON FUNCTION belief.rotate_agency_credential(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.rotate_agency_credential(uuid, text) TO service_role;

COMMENT ON FUNCTION belief.store_agency_credential(uuid, text, text, text, uuid)
  IS 'Stores a BYOK secret in Supabase Vault and returns the agency_credentials.id reference.';
COMMENT ON FUNCTION belief.decrypt_agency_credential(uuid)
  IS 'Returns plaintext for a credential. SECURITY DEFINER; service_role only.';
COMMENT ON FUNCTION belief.rotate_agency_credential(uuid, text)
  IS 'Rotates the underlying vault secret while preserving credential_id.';

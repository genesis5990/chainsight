-- ============================================================================
-- Migration 0012 — Revoke service_role SELECT on vault.decrypted_secrets
-- Spec: v1.0 Security & Sovereignty §3.2 (SaaS Blind threat model)
-- ============================================================================
--
-- Default Supabase grants SELECT on vault.decrypted_secrets to service_role.
-- That defeats the SaaS Blind promise: anyone with the service-role key —
-- including a support engineer doing routine debug — can recover every
-- BYOK secret across every agency by reading that view.
--
-- Mitigation: revoke direct read access from service_role. The intended
-- path to plaintext is belief.decrypt_agency_credential(uuid), a
-- SECURITY DEFINER function owned by postgres that selects from
-- vault.decrypted_secrets internally. The function runs with postgres
-- privileges (which still has SELECT) but callers do not.
--
-- We keep DELETE on vault.decrypted_secrets for service_role so the worker
-- can clean up rotated secrets via the rotate RPC if needed.
--
-- Validation: see scripts/validate_vault_isolation.sql — must show that
-- service_role can no longer SELECT vault.decrypted_secrets but the
-- decrypt_agency_credential() RPC still succeeds.

REVOKE SELECT ON vault.decrypted_secrets FROM service_role;

-- Optional: also lock down vault.secrets (ciphertext + nonce). Reading the
-- ciphertext is not directly harmful — pgsodium symmetric keys are not in
-- the session — but minimizing exposure is good defense in depth.
REVOKE SELECT ON vault.secrets FROM service_role;

-- Grant a tightly-scoped role for the worker to call belief.decrypt_*.
-- (For now we rely on service_role + EXECUTE on the function; the RPC
-- whitelist is the security boundary.)

COMMENT ON FUNCTION belief.decrypt_agency_credential(uuid)
  IS 'Returns plaintext for a credential. SECURITY DEFINER; service_role only. '
     'service_role NO LONGER has direct SELECT on vault.decrypted_secrets; this '
     'RPC is the only path to plaintext for support / worker code.';

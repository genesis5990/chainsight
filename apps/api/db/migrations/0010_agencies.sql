-- ============================================================================
-- Migration 0010 — Agencies, members, invitations (SaaS Blind admin foundation)
-- Spec: v1.0 Product GTM §4 + v1.0 Backend §8
-- ============================================================================
--
-- Until now belief.agency_provider_installs accepted any agency_id string,
-- including '*' for global defaults, and there was no agency directory or
-- membership concept. The SaaS Blind onboarding flow needs:
--
--   1. belief.agencies               — tenant directory
--   2. belief.agency_members         — who can do what inside an agency
--   3. belief.agency_invitations     — pending invites by email
--
-- This migration is additive: existing case_acl + atom rows are not migrated
-- onto a synthetic agency yet (that's a Phase-3 backfill). The new tables are
-- empty until an agency-admin uses the /v1/agency/* APIs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ─── 1. agencies ──────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.agencies (
  id           uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  tier         text NOT NULL DEFAULT 'investigator'
                 CHECK (tier IN ('investigator', 'team', 'enterprise')),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS agencies_slug_idx ON belief.agencies (slug)
  WHERE deleted_at IS NULL;

/* ─── 2. agency_members ────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.agency_members (
  agency_id   uuid NOT NULL REFERENCES belief.agencies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'supervisor', 'investigator')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    uuid NOT NULL,
  PRIMARY KEY (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS agency_members_user_idx ON belief.agency_members (user_id);

/* ─── 3. agency_invitations ────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS belief.agency_invitations (
  id           uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  agency_id    uuid NOT NULL REFERENCES belief.agencies(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'supervisor', 'investigator')),
  token        text NOT NULL UNIQUE,
  invited_by   uuid NOT NULL,
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS agency_invitations_pending_idx
  ON belief.agency_invitations (agency_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

/* ─── 4. agency_credentials (Vault-backed) ─────────────────────────────── */
-- pgsodium-encrypted secrets keyed by (agency_id, provider_id). The router's
-- credential_ref column references credential_id here; the new
-- VaultCredentialStore reads + decrypts via the pgsodium key id.

CREATE TABLE IF NOT EXISTS belief.agency_credentials (
  id              uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  agency_id       uuid NOT NULL REFERENCES belief.agencies(id) ON DELETE CASCADE,
  provider_id     text NOT NULL,
  label           text NOT NULL DEFAULT '',
  -- Encrypted secret. We store the raw bytea here. The
  -- pgsodium.crypto_secretbox_open*() path is used in the
  -- VaultCredentialStore (see api/db/migrations/0011 for the helper RPC if
  -- pgsodium is enabled; if not, we fall back to base64 plaintext for dev).
  secret_cipher   text NOT NULL,
  nonce           text,
  cipher_algo     text NOT NULL DEFAULT 'pgsodium' CHECK (cipher_algo IN ('pgsodium', 'plain_b64')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  rotated_at      timestamptz,
  UNIQUE (agency_id, provider_id, label)
);

CREATE INDEX IF NOT EXISTS agency_credentials_lookup_idx
  ON belief.agency_credentials (agency_id, provider_id);

/* ─── RLS ──────────────────────────────────────────────────────────────── */

ALTER TABLE belief.agencies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.agency_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.agency_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.agency_credentials  ENABLE ROW LEVEL SECURITY;

-- Helper: am I a member of this agency (any role)?
CREATE OR REPLACE FUNCTION belief.is_agency_member(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM belief.agency_members m
    WHERE m.agency_id = p_agency AND m.user_id = auth.uid()
  );
$$;

-- Helper: am I an admin of this agency?
CREATE OR REPLACE FUNCTION belief.is_agency_admin(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM belief.agency_members m
    WHERE m.agency_id = p_agency AND m.user_id = auth.uid() AND m.role = 'admin'
  );
$$;

DO $$
BEGIN
  -- agencies: readable by any member; only admins write (DB writes are via service role anyway).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agencies' AND policyname='agencies_read') THEN
    CREATE POLICY agencies_read ON belief.agencies FOR SELECT TO authenticated
      USING (belief.is_agency_member(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agencies' AND policyname='agencies_service_all') THEN
    CREATE POLICY agencies_service_all ON belief.agencies FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- agency_members: members see roster; admins write (service role only via API).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agency_members' AND policyname='agency_members_read') THEN
    CREATE POLICY agency_members_read ON belief.agency_members FOR SELECT TO authenticated
      USING (belief.is_agency_member(agency_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agency_members' AND policyname='agency_members_service_all') THEN
    CREATE POLICY agency_members_service_all ON belief.agency_members FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- invitations: only admins read their agency's pending invites.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agency_invitations' AND policyname='agency_invitations_read') THEN
    CREATE POLICY agency_invitations_read ON belief.agency_invitations FOR SELECT TO authenticated
      USING (belief.is_agency_admin(agency_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agency_invitations' AND policyname='agency_invitations_service_all') THEN
    CREATE POLICY agency_invitations_service_all ON belief.agency_invitations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- credentials: never readable to authenticated users; only service role.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='belief' AND tablename='agency_credentials' AND policyname='agency_credentials_service_all') THEN
    CREATE POLICY agency_credentials_service_all ON belief.agency_credentials FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

/* ─── Bootstrap helper: createAgency-with-admin ────────────────────────── */
-- Single-call agency creation. Inserts the agency row, makes the caller the
-- first admin, and returns the new agency_id.
CREATE OR REPLACE FUNCTION belief.create_agency(
  p_name text,
  p_slug text,
  p_tier text,
  p_creator uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO belief.agencies (name, slug, tier, created_by)
  VALUES (p_name, p_slug, COALESCE(p_tier, 'investigator'), p_creator)
  RETURNING id INTO new_id;

  INSERT INTO belief.agency_members (agency_id, user_id, role, added_by)
  VALUES (new_id, p_creator, 'admin', p_creator);

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION belief.create_agency(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.create_agency(text, text, text, uuid) TO service_role;

-- Accept invitation helper.
CREATE OR REPLACE FUNCTION belief.accept_agency_invitation(
  p_token text,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = belief, extensions, pg_temp
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT * INTO inv FROM belief.agency_invitations
  WHERE token = p_token AND accepted_at IS NULL AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_invalid_or_expired';
  END IF;

  INSERT INTO belief.agency_members (agency_id, user_id, role, added_by)
  VALUES (inv.agency_id, p_user_id, inv.role, inv.invited_by)
  ON CONFLICT (agency_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE belief.agency_invitations SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.agency_id;
END;
$$;

REVOKE ALL ON FUNCTION belief.accept_agency_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION belief.accept_agency_invitation(text, uuid) TO service_role;

COMMENT ON TABLE belief.agencies            IS 'SaaS Blind agency directory (Phase-2 §1).';
COMMENT ON TABLE belief.agency_members      IS 'Per-agency role assignments. role in (admin, supervisor, investigator).';
COMMENT ON TABLE belief.agency_invitations  IS 'Pending email invitations; consumed by accept_agency_invitation().';
COMMENT ON TABLE belief.agency_credentials  IS 'Vault-backed BYOK secrets, pgsodium-encrypted in production.';

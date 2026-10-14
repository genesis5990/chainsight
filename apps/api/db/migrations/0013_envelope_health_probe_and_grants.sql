-- 0013: envelope health probe table + service_role grants for tables created
-- after 0001.
--
-- 1. belief.envelope_health_probe
--    The worker records its envelope-cipher status here at boot (see
--    apps/worker/src/index.ts) so ops can confirm api and worker share the
--    same CHAINSIGHT_MASTER_KEY by comparing key_fp. key_fp is a short SHA-256
--    fingerprint of the key, never the key itself. Referenced by commit
--    dbb145d but never committed; this file restores it so a fresh database
--    can be built from the repo alone.
--
-- 2. Grants
--    0001 ran `GRANT ... ON ALL TABLES IN SCHEMA belief`, which only covers
--    tables that existed at that point. Tables from 0003-0006 had no grants,
--    so on a fresh project the service_role (API + worker) could not read or
--    write them. This brings every belief table to the 0001 baseline
--    (SELECT, INSERT, UPDATE) and adds DELETE only where the code deletes.
--    Default privileges cover tables added by later migrations.

CREATE TABLE IF NOT EXISTS belief.envelope_health_probe (
  service       text PRIMARY KEY,
  active        boolean NOT NULL,
  key_fp        text,
  roundtrip_ok  boolean NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE belief.envelope_health_probe ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) reads or writes it.

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA belief TO service_role;
GRANT DELETE ON belief.agency_credentials, belief.agency_provider_installs TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA belief
  GRANT SELECT, INSERT, UPDATE ON TABLES TO service_role;

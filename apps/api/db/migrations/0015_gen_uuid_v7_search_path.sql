-- 0015: make belief.gen_uuid_v7() independent of the caller's search_path.
--
-- gen_uuid_v7() calls pgcrypto's gen_random_bytes() unqualified and had no
-- search_path of its own, so it resolved against whoever called it. On
-- Supabase, pgcrypto is installed in the `extensions` schema. Functions that
-- harden their search_path to `belief, pg_temp` (insert_atom_with_event and
-- others) then fail on every insert that uses the id default:
--
--   insert_atom_with_event failed: function gen_random_bytes(integer) does not exist
--
-- which meant no belief atom could ever be written. Table defaults used
-- directly through PostgREST worked only because PostgREST's search_path
-- includes `extensions`.
--
-- Pinning the function's own search_path fixes every caller. `public` is
-- included for self-hosted installs where pgcrypto lives there.

CREATE OR REPLACE FUNCTION belief.gen_uuid_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SET search_path = belief, extensions, public, pg_temp
AS $function$
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
$function$;

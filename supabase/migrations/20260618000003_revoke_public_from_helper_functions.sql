-- Postgres grants EXECUTE to PUBLIC on functions by default. Our previous
-- revoke from anon/authenticated only removed those role grants; PUBLIC was
-- still implicitly granted. This revoke completes the lockdown.
--
-- See: Supabase advisor 0028/0029 (still firing after prev migration).

revoke execute on function public.current_agency_id() from public;
revoke execute on function public.current_role_value() from public;

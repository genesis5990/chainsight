-- Revoke EXECUTE on helper functions from anon and authenticated roles.
-- These functions are internal — they should only be called by RLS policy
-- evaluation (which runs as the table owner, not the caller's role), never
-- exposed via PostgREST's /rpc endpoint.
--
-- See: Supabase advisor 0028/0029, security_sovereignty.md §6.

revoke execute on function public.current_agency_id() from anon;
revoke execute on function public.current_agency_id() from authenticated;
revoke execute on function public.current_role_value() from anon;
revoke execute on function public.current_role_value() from authenticated;

-- Keep grants for the service_role (used by the backend with service key)
-- and to the table-owner role (used by RLS policy evaluation).
grant execute on function public.current_agency_id() to service_role;
grant execute on function public.current_role_value() to service_role;

-- ============================================================================
-- HomeOps Migration 00006: Table privileges for the API roles
-- ============================================================================
-- Newer Supabase projects don't auto-grant public tables to the API roles, so
-- every query failed with "permission denied for table ...":
--   service_role  = the Worker (bypasses RLS, but still needs GRANTs)
--   authenticated = logged-in operators on the dashboard (RLS limits them to is_operator())
-- anon gets nothing: no client uses it.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- So tables added by future migrations don't hit the same error.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, service_role;

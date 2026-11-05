-- ============================================================================
-- HomeOps Migration 00004: Security Hardening
-- ============================================================================
-- 1. Enable RLS on the two tables 00002 missed. Without RLS, anyone holding the
--    public anon key could read/write them through the Supabase REST API.
--    The Worker uses the service_role key, which bypasses RLS, so it is unaffected.
-- 2. Lock the SECURITY DEFINER RPCs from 00003 to service_role only. Otherwise
--    anon could call accept_service_request_offer() over /rest/v1/rpc and
--    receive a customer's exact address and phone number.
-- 3. Pin search_path on functions (Supabase security advisor requirement).
-- ============================================================================

-- 1. Missing RLS ---------------------------------------------------------------
ALTER TABLE assignment_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_telegram_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators have full access to assignment_conversations"
    ON assignment_conversations FOR ALL
    USING (is_operator());

-- 2. Restrict backend-only RPCs to service_role --------------------------------
REVOKE EXECUTE ON FUNCTION accept_service_request_offer(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_expired_search_requests(INT)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finalize_batch_progression(UUID, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_technician_metrics(UUID)                FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION accept_service_request_offer(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_expired_search_requests(INT)             TO service_role;
GRANT EXECUTE ON FUNCTION finalize_batch_progression(UUID, INT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION update_technician_metrics(UUID)                TO service_role;

-- is_operator() is used by RLS policies and by the dashboard login check.
REVOKE EXECUTE ON FUNCTION is_operator() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_operator() TO authenticated, service_role;

-- 3. Pin search_path -------------------------------------------------------------
ALTER FUNCTION is_operator()                                   SET search_path = public;
ALTER FUNCTION update_timestamp()                              SET search_path = public;
ALTER FUNCTION accept_service_request_offer(UUID, UUID, UUID)  SET search_path = public;
ALTER FUNCTION claim_expired_search_requests(INT)              SET search_path = public;
ALTER FUNCTION finalize_batch_progression(UUID, INT, BOOLEAN)  SET search_path = public;
ALTER FUNCTION update_technician_metrics(UUID)                 SET search_path = public;

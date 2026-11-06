-- ============================================================================
-- HomeOps Migration 00005: Operator dashboard read access
-- ============================================================================
-- 00002 enabled RLS on these tables but gave operators no policy, so the
-- dashboard (which uses the operator's login, not the service key) could not
-- read the request audit trail, saved addresses, attachments or inactive catalog rows.

-- Lets a logged-in operator read their own row (dashboard uses it to record approved_by).
CREATE POLICY "Operators can read own operator profile"
    ON operator_profiles FOR SELECT
    USING (supabase_auth_user_id = auth.uid());

CREATE POLICY "Operators can read request_events"
    ON request_events FOR SELECT
    USING (is_operator());

CREATE POLICY "Operators can read customer_addresses"
    ON customer_addresses FOR SELECT
    USING (is_operator());

CREATE POLICY "Operators can read attachments"
    ON attachments FOR SELECT
    USING (is_operator());

CREATE POLICY "Operators have full access to service_categories"
    ON service_categories FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to issue_types"
    ON issue_types FOR ALL
    USING (is_operator());

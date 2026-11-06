-- ============================================================================
-- HomeOps Migration 00010: Enforce MFA for administrator accounts (spec §10.1)
-- ============================================================================
-- The dashboard shows an MFA screen to ADMIN operators, but a UI check alone can be
-- bypassed by calling the API directly. Every operator RLS policy goes through
-- is_operator(), so requiring aal2 here enforces MFA for all operator data access.
-- (The Worker's /api/operator/* applies the same rule in requireOperator.)

CREATE OR REPLACE FUNCTION is_operator()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM operator_profiles
        WHERE supabase_auth_user_id = auth.uid()
          AND active = TRUE
          AND (operator_role <> 'ADMIN' OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
    );
END;
$$;

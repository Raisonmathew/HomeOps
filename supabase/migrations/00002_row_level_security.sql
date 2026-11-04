-- ============================================================================
-- HomeOps Migration 00002: Row-Level Security (RLS) & Triggers
-- ============================================================================

-- Enable RLS across tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Public Read for Catalog
-- ----------------------------------------------------------------------------
CREATE POLICY "Public can view active categories"
    ON service_categories FOR SELECT
    USING (active = TRUE);

CREATE POLICY "Public can view active issue types"
    ON issue_types FOR SELECT
    USING (active = TRUE);

-- ----------------------------------------------------------------------------
-- Dashboard Staff / Supabase Auth Policies
-- ----------------------------------------------------------------------------
-- Helper to check if the caller is an authenticated staff operator
CREATE OR REPLACE FUNCTION is_operator()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM operator_profiles
        WHERE supabase_auth_user_id = auth.uid() AND active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Operators have full access to profiles"
    ON profiles FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to technician_profiles"
    ON technician_profiles FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to technician_skills"
    ON technician_skills FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to technician_availability"
    ON technician_availability FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to service_requests"
    ON service_requests FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to request_offers"
    ON request_offers FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to complaints"
    ON complaints FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to estimate_records"
    ON estimate_records FOR ALL
    USING (is_operator());

CREATE POLICY "Operators have full access to ratings"
    ON ratings FOR ALL
    USING (is_operator());

-- ----------------------------------------------------------------------------
-- Profile updated_at Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_technician_profiles_updated_at
    BEFORE UPDATE ON technician_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

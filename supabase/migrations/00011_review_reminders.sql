-- ============================================================================
-- HomeOps Migration 00011: Review reminders
-- ============================================================================
-- The bot reminds customers and technicians about jobs they haven't reviewed the
-- next time they open it. "Skip this review" is remembered here so it stops asking.

CREATE TABLE IF NOT EXISTS review_skips (
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (service_request_id, profile_id)
);

ALTER TABLE review_skips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read review_skips" ON review_skips FOR SELECT USING (is_operator());
GRANT ALL ON review_skips TO service_role;
GRANT SELECT ON review_skips TO authenticated;

-- ============================================================================
-- HomeOps Migration 00007: Persistent bot conversation state
-- ============================================================================
-- Multi-step bot flows (technician application, service request) were kept in
-- Worker memory, which is per-isolate and lost between requests. Store them here.
-- Only the Worker (service_role) touches this table; RLS with no policies blocks everyone else.

CREATE TABLE bot_sessions (
    telegram_user_id BIGINT PRIMARY KEY,
    step TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;

-- Explicit, in case this runs under a role the 00006 default privileges don't cover.
GRANT ALL ON bot_sessions TO service_role;

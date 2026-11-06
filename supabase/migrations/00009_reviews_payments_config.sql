-- ============================================================================
-- HomeOps Migration 00009: Two-way reviews, payment declaration, live config,
-- scheduled-slot search, daily maintenance
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Two-way reviews (spec §6.9): both parties rate each other, with quick tags
-- ----------------------------------------------------------------------------
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- ----------------------------------------------------------------------------
-- 2. Direct-payment declaration (spec §6.7). HomeOps records, never verifies, payment.
-- ----------------------------------------------------------------------------
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS payment_declaration TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (payment_declaration IN (
        'NOT_APPLICABLE',
        'DIRECT_PAYMENT_CONFIRMED_BY_CUSTOMER',
        'DIRECT_PAYMENT_CONFIRMED_BY_TECHNICIAN',
        'PAYMENT_DISPUTE_REPORTED'
    ));

-- ----------------------------------------------------------------------------
-- 3. Marketplace settings editable from the dashboard (spec §6.5: "configurable without a new deployment")
--    Keys mirror worker/src/config/constants.ts; the Worker overlays these values every minute.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_config (
    key TEXT PRIMARY KEY,
    value NUMERIC NOT NULL CHECK (value >= 0),
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES profiles(id)
);
ALTER TABLE marketplace_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators manage marketplace_config" ON marketplace_config FOR ALL USING (is_operator());
GRANT ALL ON marketplace_config TO authenticated, service_role;

INSERT INTO marketplace_config (key, value, description) VALUES
    ('MATCHING_WEIGHTS.SKILL_FIT',            30,  'Ranking weight: skill fit'),
    ('MATCHING_WEIGHTS.PROXIMITY',            25,  'Ranking weight: proximity'),
    ('MATCHING_WEIGHTS.TIME_AVAILABILITY',    15,  'Ranking weight: time availability'),
    ('MATCHING_WEIGHTS.RELIABILITY',          15,  'Ranking weight: reliability'),
    ('MATCHING_WEIGHTS.RATING',               10,  'Ranking weight: rating'),
    ('MATCHING_WEIGHTS.FAIRNESS',              5,  'Ranking weight: fairness'),
    ('BATCH_CONFIG.BATCH_1_SIZE',              3,  'Technicians offered in batch 1'),
    ('BATCH_CONFIG.BATCH_1_TIMEOUT_SECONDS',  90,  'Batch 1 offer expiry (seconds)'),
    ('BATCH_CONFIG.BATCH_2_SIZE',              3,  'Technicians offered in batches 2-3'),
    ('BATCH_CONFIG.BATCH_2_TIMEOUT_SECONDS',  90,  'Batch 2 offer expiry (seconds)'),
    ('BATCH_CONFIG.BATCH_3_TIMEOUT_SECONDS', 180,  'Batch 3 offer expiry (seconds)'),
    ('BATCH_CONFIG.MAX_ACTIVE_ASSIGNMENTS',    2,  'Max concurrent active jobs per technician'),
    ('SEARCH.LEAD_TIME_HOURS',                 2,  'Scheduled requests start searching this many hours before the slot'),
    ('RETENTION.TELEGRAM_UPDATES_DAYS',       30,  'Keep webhook idempotency records (spec §12)'),
    ('RETENTION.MEDIA_DAYS',                  90,  'Keep issue-photo references (spec §12)')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION config_value(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT value FROM marketplace_config WHERE key = p_key), p_default);
$$;

-- ----------------------------------------------------------------------------
-- 4. Batch claim: also start deferred (scheduled) searches once their slot is near.
--    Same signature/return type as 00008, so CREATE OR REPLACE keeps the grants.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_expired_search_requests(p_claim_timeout_seconds INT DEFAULT 120)
RETURNS TABLE (
    request_id UUID,
    current_batch INT,
    service_category_id UUID,
    issue_type_id UUID,
    service_latitude NUMERIC,
    service_longitude NUMERIC,
    urgency urgency_level,
    category_name TEXT,
    issue_name TEXT,
    service_locality TEXT,
    preferred_start_time TIMESTAMPTZ,
    preferred_end_time TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH expired_candidates AS (
        SELECT sr.id
        FROM service_requests sr
        WHERE sr.status = 'SEARCHING'
          AND sr.assigned_technician_id IS NULL
          AND (
              sr.batch_progression_status = 'IDLE'
              OR (
                  sr.batch_progression_status = 'PROCESSING'
                  AND sr.batch_progression_claimed_at < NOW() - (p_claim_timeout_seconds || ' seconds')::INTERVAL
              )
          )
          AND (
              -- running search: every offer in the batch has been answered or has expired
              (
                  EXISTS (SELECT 1 FROM request_offers ro WHERE ro.service_request_id = sr.id)
                  AND NOT EXISTS (
                      SELECT 1 FROM request_offers ro
                      WHERE ro.service_request_id = sr.id
                        AND ro.offer_status IN ('SENT', 'VIEWED')
                        AND ro.expires_at > NOW()
                  )
              )
              -- scheduled request: no offers yet and the slot is within the lead time
              OR (
                  NOT EXISTS (SELECT 1 FROM request_offers ro WHERE ro.service_request_id = sr.id)
                  AND sr.preferred_start_time <= NOW() + make_interval(hours => config_value('SEARCH.LEAD_TIME_HOURS', 2)::INT)
              )
          )
          AND NOT EXISTS (
              SELECT 1 FROM request_offers ro
              WHERE ro.service_request_id = sr.id AND ro.offer_status = 'ACCEPTED'
          )
        FOR UPDATE SKIP LOCKED
    ),
    claimed_rows AS (
        UPDATE service_requests sr
        SET batch_progression_status = 'PROCESSING',
            batch_progression_claimed_at = NOW()
        FROM expired_candidates ec
        WHERE sr.id = ec.id
        RETURNING sr.*
    )
    SELECT cr.id, cr.current_offer_batch, cr.service_category_id, cr.issue_type_id,
           cr.service_latitude, cr.service_longitude, cr.urgency, sc.name, it.name,
           cr.service_locality, cr.preferred_start_time, cr.preferred_end_time
    FROM claimed_rows cr
    JOIN service_categories sc ON sc.id = cr.service_category_id
    JOIN issue_types it ON it.id = cr.issue_type_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Technician metrics: rating only from reviews OF the technician, real reliability
--    rates, and no longer touching probation (operators complete it, spec §18.5).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_technician_metrics(p_technician_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_completed INT;
    v_finished INT;
    v_assigned INT;
    v_tech_cancelled INT;
    v_reopened INT;
    v_offers_answered INT;
    v_offers_accepted INT;
    v_complaints INT;
BEGIN
    SELECT profile_id INTO v_profile_id FROM technician_profiles WHERE id = p_technician_id;

    SELECT
        COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PARTIALLY_COMPLETED')),
        COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'UNABLE_TO_COMPLETE', 'CANCELLED_BY_TECHNICIAN')),
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'CANCELLED_BY_TECHNICIAN')
    INTO v_completed, v_finished, v_assigned, v_tech_cancelled
    FROM service_requests WHERE assigned_technician_id = p_technician_id;

    -- Jobs the technician dropped right after accepting were re-opened and are no longer assigned
    -- to them; count them from the audit trail, in both the numerator and the denominator.
    SELECT COUNT(*) INTO v_reopened FROM request_events
    WHERE event_type = 'CANCELLED_BY_TECHNICIAN' AND new_status = 'SEARCHING' AND performed_by = v_profile_id;
    v_tech_cancelled := v_tech_cancelled + v_reopened;
    v_assigned := v_assigned + v_reopened;

    SELECT
        COUNT(*) FILTER (WHERE offer_status IN ('ACCEPTED', 'DECLINED', 'EXPIRED')),
        COUNT(*) FILTER (WHERE offer_status = 'ACCEPTED')
    INTO v_offers_answered, v_offers_accepted
    FROM request_offers WHERE technician_id = p_technician_id;

    SELECT COUNT(*) INTO v_complaints FROM complaints WHERE reported_against = v_profile_id;

    UPDATE technician_profiles
    SET completed_request_count = v_completed,
        average_rating = COALESCE((SELECT ROUND(AVG(score)::NUMERIC, 2) FROM ratings WHERE reviewed_profile_id = v_profile_id), 0),
        acceptance_rate = CASE WHEN v_offers_answered > 0 THEN v_offers_accepted::NUMERIC / v_offers_answered ELSE 1 END,
        completion_rate = CASE WHEN v_finished > 0 THEN v_completed::NUMERIC / v_finished ELSE 1 END,
        post_acceptance_cancellation_rate = CASE WHEN v_assigned > 0 THEN v_tech_cancelled::NUMERIC / v_assigned ELSE 0 END,
        complaint_rate = CASE WHEN v_assigned > 0 THEN LEAST(1, v_complaints::NUMERIC / v_assigned) ELSE 0 END,
        updated_at = NOW()
    WHERE id = p_technician_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Daily maintenance (run by the Worker's daily cron): retention (spec §12),
--    stale availability, rolling fair-rotation counters (spec §18.3), metrics refresh.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION run_daily_maintenance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updates INT; v_sessions INT; v_media INT; v_tech RECORD;
BEGIN
    DELETE FROM processed_telegram_updates
    WHERE processed_at < NOW() - make_interval(days => config_value('RETENTION.TELEGRAM_UPDATES_DAYS', 30)::INT);
    GET DIAGNOSTICS v_updates = ROW_COUNT;

    DELETE FROM bot_sessions WHERE updated_at < NOW() - INTERVAL '1 day';
    GET DIAGNOSTICS v_sessions = ROW_COUNT;

    -- Telegram-only photo references past retention, and draft photos never attached to a request.
    -- Rows promoted to Supabase Storage (storage_path set) are kept for operator handling.
    DELETE FROM attachments
    WHERE storage_path IS NULL
      AND ((expires_at IS NOT NULL AND expires_at < NOW())
           OR (service_request_id IS NULL AND created_at < NOW() - INTERVAL '1 day'));
    GET DIAGNOSTICS v_media = ROW_COUNT;

    UPDATE technician_availability SET availability_status = 'EXPIRED'
    WHERE availability_status = 'ONLINE' AND location_expires_at < NOW();

    UPDATE technician_profiles tp SET
        recent_offer_count_7d = (SELECT COUNT(*) FROM request_offers ro
                                 WHERE ro.technician_id = tp.id AND ro.offered_at > NOW() - INTERVAL '7 days'),
        recent_assignment_count_30d = (SELECT COUNT(*) FROM service_requests sr
                                       WHERE sr.assigned_technician_id = tp.id AND sr.assigned_at > NOW() - INTERVAL '30 days');

    FOR v_tech IN SELECT id FROM technician_profiles LOOP
        PERFORM update_technician_metrics(v_tech.id);
    END LOOP;

    RETURN jsonb_build_object('telegram_updates_deleted', v_updates, 'sessions_deleted', v_sessions, 'media_refs_deleted', v_media);
END;
$$;

REVOKE EXECUTE ON FUNCTION run_daily_maintenance()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION config_value(TEXT, NUMERIC)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION run_daily_maintenance()         TO service_role;
GRANT  EXECUTE ON FUNCTION config_value(TEXT, NUMERIC)     TO service_role;

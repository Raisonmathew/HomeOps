-- ============================================================================
-- HomeOps Migration 00012: Fake-work protection, cancellations, abuse signals
-- ============================================================================

-- Start PIN (customer gives it to the technician on arrival; proves they met) and closure reason
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS start_pin TEXT;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS start_pin_attempts INT NOT NULL DEFAULT 0;
-- Why a job ended early, e.g. CUSTOMER_NOT_AVAILABLE (counted against the customer, not the technician)
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS closure_reason TEXT;

-- System-raised flags (fast completion, no-show, late cancels, collusion...) reuse the complaints
-- queue so operators see them in one place. They have no human reporter.
ALTER TABLE complaints ALTER COLUMN reported_by DROP NOT NULL;

INSERT INTO marketplace_config (key, value, description) VALUES
    ('SAFETY.MIN_WORK_MINUTES',              10, 'Completion sooner than this after "Work Started" is flagged'),
    ('SAFETY.MAX_PIN_ATTEMPTS',               5, 'Wrong start-PIN entries before the job is flagged and locked'),
    ('SLA.NO_CONTACT_NUDGE_MINUTES',         30, 'Remind an assigned technician who has not contacted the customer'),
    ('SLA.NO_CONTACT_REASSIGN_MINUTES',      60, 'Re-open the search if the technician still has not contacted the customer'),
    ('SLA.CONFIRM_REMIND_HOURS',             48, 'Remind a customer who has not confirmed a completed job'),
    ('SLA.CONFIRM_ESCALATE_HOURS',           72, 'Send an unconfirmed job to operator review'),
    ('SLA.STALE_JOB_HOURS',                  24, 'Flag jobs stuck in progress this long'),
    ('LIMITS.MAX_OPEN_REQUESTS',              2, 'Open requests a customer may have at once'),
    ('LIMITS.LATE_CANCEL_FLAG_COUNT',         3, 'Customer late cancellations / no-shows in 30 days before flagging'),
    ('LIMITS.TECH_CANCEL_FLAG_COUNT',         3, 'Technician cancellations in 7 days before flagging')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Ratings only count once a job is confirmed (or an operator closed a dispute as done):
-- a fake completion can't earn or inflict a rating, and disputed jobs are held.
-- Completion rate ignores jobs ended because the customer wasn't available.
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
        COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED_BY_TECHNICIAN')
                            OR (status = 'UNABLE_TO_COMPLETE' AND COALESCE(closure_reason, '') <> 'CUSTOMER_NOT_AVAILABLE')),
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'CANCELLED_BY_TECHNICIAN')
    INTO v_completed, v_finished, v_assigned, v_tech_cancelled
    FROM service_requests WHERE assigned_technician_id = p_technician_id;

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
        average_rating = COALESCE((
            SELECT ROUND(AVG(r.score)::NUMERIC, 2)
            FROM ratings r JOIN service_requests sr ON sr.id = r.service_request_id
            WHERE r.reviewed_profile_id = v_profile_id AND sr.status IN ('COMPLETED', 'PARTIALLY_COMPLETED')
        ), 0),
        acceptance_rate = CASE WHEN v_offers_answered > 0 THEN v_offers_accepted::NUMERIC / v_offers_answered ELSE 1 END,
        completion_rate = CASE WHEN v_finished > 0 THEN v_completed::NUMERIC / v_finished ELSE 1 END,
        post_acceptance_cancellation_rate = CASE WHEN v_assigned > 0 THEN v_tech_cancelled::NUMERIC / v_assigned ELSE 0 END,
        complaint_rate = CASE WHEN v_assigned > 0 THEN LEAST(1, v_complaints::NUMERIC / v_assigned) ELSE 0 END,
        updated_at = NOW()
    WHERE id = p_technician_id;
END;
$$;

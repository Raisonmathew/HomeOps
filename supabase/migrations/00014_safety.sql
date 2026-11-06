-- ============================================================================
-- HomeOps Migration 00014: Safety & anti-harassment (both customers and technicians)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Relay transcript: evidence for harassment reports. Operators only; deleted by the
--    daily job after RETENTION.RELAY_DAYS (disclosed in the bot's Terms).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relay_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    sender_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    recipient_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_relay_messages_request ON relay_messages(service_request_id, created_at);
ALTER TABLE relay_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read relay_messages" ON relay_messages FOR SELECT USING (is_operator());
GRANT ALL ON relay_messages TO service_role;
GRANT SELECT ON relay_messages TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Report categories and urgency
-- ----------------------------------------------------------------------------
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (category IN ('HARASSMENT', 'UNSAFE', 'FRAUD', 'SERVICE', 'PAYMENT', 'OTHER', 'AUTO'));
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('NORMAL', 'URGENT'));
UPDATE complaints SET category = 'AUTO'    WHERE complaint_type LIKE 'AUTO:%';
UPDATE complaints SET category = 'PAYMENT' WHERE complaint_type = 'Payment dispute';
UPDATE complaints SET category = 'SERVICE' WHERE complaint_type IN ('Service dispute', 'Cancellation request');
UPDATE complaints SET category = 'HARASSMENT', priority = 'URGENT' WHERE complaint_type = 'Blocked in chat relay';

-- ----------------------------------------------------------------------------
-- 3. Ratings held while a harassment/safety report about the reviewer is open
--    (stops retaliation ratings). Released when the report is resolved without action.
-- ----------------------------------------------------------------------------
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS held BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION release_held_ratings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'RESOLVED' AND OLD.status IS DISTINCT FROM 'RESOLVED' AND NEW.category IN ('HARASSMENT', 'UNSAFE') THEN
        UPDATE ratings SET held = FALSE
        WHERE service_request_id = NEW.service_request_id AND reviewer_id = NEW.reported_against;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_complaints_release_ratings ON complaints;
CREATE TRIGGER trg_complaints_release_ratings AFTER UPDATE ON complaints
    FOR EACH ROW EXECUTE FUNCTION release_held_ratings();

-- ----------------------------------------------------------------------------
-- 4. Formal warnings issued by operators
-- ----------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS warning_count INT NOT NULL DEFAULT 0;

-- Audit trail of account actions (spec §11.10: operator actions must be audited).
-- actor_profile_id NULL = automatic action by the system (e.g. repeat-harassment restriction).
CREATE TABLE IF NOT EXISTS account_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    actor_profile_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL CHECK (action IN ('WARN', 'RESTRICT', 'SUSPEND', 'REACTIVATE')),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE account_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read account_actions" ON account_actions FOR SELECT USING (is_operator());
GRANT ALL ON account_actions TO service_role;
GRANT SELECT ON account_actions TO authenticated;

INSERT INTO marketplace_config (key, value, description) VALUES
    ('SAFETY.HARASSMENT_RESTRICT_COUNT', 2,  'Harassment/safety reports in 90 days that automatically restrict an account (pending operator review)'),
    ('RETENTION.RELAY_DAYS',            90,  'Keep relayed chat messages (evidence) this many days')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Technician ID documents: private bucket, readable only by operators (spec §6.2, §11.13, §18.4).
--    The Worker uploads with the service role, which bypasses storage RLS.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('verification-docs', 'verification-docs', FALSE)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Operators read verification docs" ON storage.objects;
CREATE POLICY "Operators read verification docs" ON storage.objects
    FOR SELECT USING (bucket_id = 'verification-docs' AND public.is_operator());

-- ----------------------------------------------------------------------------
-- 6. Technician average excludes held ratings (otherwise identical to 00012)
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
            WHERE r.reviewed_profile_id = v_profile_id AND NOT r.held
              AND sr.status IN ('COMPLETED', 'PARTIALLY_COMPLETED')
        ), 0),
        acceptance_rate = CASE WHEN v_offers_answered > 0 THEN v_offers_accepted::NUMERIC / v_offers_answered ELSE 1 END,
        completion_rate = CASE WHEN v_finished > 0 THEN v_completed::NUMERIC / v_finished ELSE 1 END,
        post_acceptance_cancellation_rate = CASE WHEN v_assigned > 0 THEN v_tech_cancelled::NUMERIC / v_assigned ELSE 0 END,
        complaint_rate = CASE WHEN v_assigned > 0 THEN LEAST(1, v_complaints::NUMERIC / v_assigned) ELSE 0 END,
        updated_at = NOW()
    WHERE id = p_technician_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Daily maintenance also deletes old relay transcripts (otherwise identical to 00009)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION run_daily_maintenance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updates INT; v_sessions INT; v_media INT; v_relay INT; v_tech RECORD;
BEGIN
    DELETE FROM processed_telegram_updates
    WHERE processed_at < NOW() - make_interval(days => config_value('RETENTION.TELEGRAM_UPDATES_DAYS', 30)::INT);
    GET DIAGNOSTICS v_updates = ROW_COUNT;

    DELETE FROM bot_sessions WHERE updated_at < NOW() - INTERVAL '1 day';
    GET DIAGNOSTICS v_sessions = ROW_COUNT;

    DELETE FROM attachments
    WHERE storage_path IS NULL
      AND ((expires_at IS NOT NULL AND expires_at < NOW())
           OR (service_request_id IS NULL AND created_at < NOW() - INTERVAL '1 day'));
    GET DIAGNOSTICS v_media = ROW_COUNT;

    -- Keep transcripts that are evidence in an open report
    DELETE FROM relay_messages rm
    WHERE rm.created_at < NOW() - make_interval(days => config_value('RETENTION.RELAY_DAYS', 90)::INT)
      AND NOT EXISTS (
          SELECT 1 FROM complaints c
          WHERE c.service_request_id = rm.service_request_id
            AND c.status NOT IN ('RESOLVED', 'ACCOUNT_ACTION_TAKEN')
      );
    GET DIAGNOSTICS v_relay = ROW_COUNT;

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

    RETURN jsonb_build_object('telegram_updates_deleted', v_updates, 'sessions_deleted', v_sessions,
                              'media_refs_deleted', v_media, 'relay_messages_deleted', v_relay);
END;
$$;

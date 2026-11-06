-- ============================================================================
-- HomeOps Migration 00008: Request-flow fixes
-- ============================================================================
-- 1. General locality for offers (spec §6.6: technicians see area, not address).
-- 2. increment_technician_offer_count(): called by the Worker for fair rotation
--    (spec §18.3) but never created.
-- 3. claim_expired_search_requests(): advance a batch once no offer is still live,
--    so a batch where everyone DECLINED moves on (it previously stalled forever),
--    and return the names/locality the next batch's offer messages need.
-- 4. accept_service_request_offer(): reject expired or foreign offers (spec §6.5).

ALTER TABLE service_requests  ADD COLUMN IF NOT EXISTS service_locality TEXT;
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS locality TEXT;

-- ----------------------------------------------------------------------------
-- 2. Fair-rotation counters
-- ----------------------------------------------------------------------------
-- shortcut: recent_offer_count_7d only grows; add a nightly decay job before the pilot scales.
CREATE OR REPLACE FUNCTION increment_technician_offer_count(p_technician_id UUID, p_offered_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE technician_profiles
    SET last_offered_at = p_offered_at,
        recent_offer_count_7d = recent_offer_count_7d + 1
    WHERE id = p_technician_id;
$$;

-- ----------------------------------------------------------------------------
-- 3. Batch claim (return type changes, so drop and recreate)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS claim_expired_search_requests(INT);

CREATE FUNCTION claim_expired_search_requests(p_claim_timeout_seconds INT DEFAULT 120)
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
          -- the search has started (at least one offer was sent)...
          AND EXISTS (SELECT 1 FROM request_offers ro WHERE ro.service_request_id = sr.id)
          -- ...and nothing is still waiting for an answer (declined, expired or cancelled all count as done)
          AND NOT EXISTS (
              SELECT 1 FROM request_offers ro
              WHERE ro.service_request_id = sr.id
                AND ro.offer_status IN ('SENT', 'VIEWED')
                AND ro.expires_at > NOW()
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
    SELECT
        cr.id,
        cr.current_offer_batch,
        cr.service_category_id,
        cr.issue_type_id,
        cr.service_latitude,
        cr.service_longitude,
        cr.urgency,
        sc.name,
        it.name,
        cr.service_locality,
        cr.preferred_start_time,
        cr.preferred_end_time
    FROM claimed_rows cr
    JOIN service_categories sc ON sc.id = cr.service_category_id
    JOIN issue_types it ON it.id = cr.issue_type_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Atomic acceptance (same signature; CREATE OR REPLACE keeps 00004's grants)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_service_request_offer(
    p_request_id UUID,
    p_technician_id UUID,
    p_offer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated_rows INT;
    v_request RECORD;
    v_customer RECORD;
    v_technician RECORD;
BEGIN
    -- 0. The offer must be this technician's, for this request, unanswered and unexpired.
    IF NOT EXISTS (
        SELECT 1 FROM request_offers
        WHERE id = p_offer_id
          AND service_request_id = p_request_id
          AND technician_id = p_technician_id
          AND offer_status IN ('SENT', 'VIEWED')
          AND expires_at > NOW()
    ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'OFFER_EXPIRED');
    END IF;

    -- 1. Atomic lock and assignment
    UPDATE service_requests
    SET assigned_technician_id = p_technician_id,
        status = 'ASSIGNED',
        assigned_at = NOW(),
        batch_progression_status = 'IDLE'
    WHERE id = p_request_id
      AND status = 'SEARCHING'
      AND assigned_technician_id IS NULL;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    IF v_updated_rows = 0 THEN
        UPDATE request_offers
        SET offer_status = 'LOST_TO_ANOTHER_TECHNICIAN', responded_at = NOW()
        WHERE id = p_offer_id;
        RETURN jsonb_build_object('success', false, 'reason', 'ALREADY_ASSIGNED_OR_CANCELLED');
    END IF;

    -- 2. Winning offer
    UPDATE request_offers SET offer_status = 'ACCEPTED', responded_at = NOW() WHERE id = p_offer_id;

    -- 3. Competing offers
    UPDATE request_offers
    SET offer_status = 'LOST_TO_ANOTHER_TECHNICIAN', responded_at = NOW()
    WHERE service_request_id = p_request_id AND id != p_offer_id AND offer_status IN ('SENT', 'VIEWED');

    -- 4. Audit event
    INSERT INTO request_events (service_request_id, event_type, old_status, new_status, performed_by, notes)
    SELECT p_request_id, 'ASSIGNED', 'SEARCHING', 'ASSIGNED', tp.profile_id, 'Technician accepted offer atomically'
    FROM technician_profiles tp WHERE tp.id = p_technician_id;

    -- 5. Relay conversation (guaranteed contact fallback, spec §18.2)
    SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;
    SELECT * INTO v_customer FROM profiles WHERE id = v_request.customer_id;
    SELECT tp.*, p.telegram_username, p.phone_number INTO v_technician
    FROM technician_profiles tp JOIN profiles p ON p.id = tp.profile_id
    WHERE tp.id = p_technician_id;

    -- A re-opened request already has a (closed) relay row: reactivate it for the new technician.
    INSERT INTO assignment_conversations (service_request_id, customer_id, technician_id, relay_status)
    VALUES (p_request_id, v_request.customer_id, v_technician.profile_id, 'ACTIVE')
    ON CONFLICT (service_request_id) DO UPDATE
        SET technician_id = EXCLUDED.technician_id, relay_status = 'ACTIVE', closed_at = NULL;

    RETURN jsonb_build_object(
        'success', true,
        'request_id', p_request_id,
        'request_number', v_request.request_number,
        'service_address_text', v_request.service_address_text,
        'service_latitude', v_request.service_latitude,
        'service_longitude', v_request.service_longitude,
        'description', v_request.description,
        'customer_phone', v_customer.phone_number,
        'customer_username', v_customer.telegram_username,
        'customer_telegram_user_id', v_customer.telegram_user_id
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- Backend-only RPCs: service_role only (same policy as 00004; functions default to PUBLIC EXECUTE)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION claim_expired_search_requests(INT)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_technician_offer_count(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION claim_expired_search_requests(INT)                 TO service_role;
GRANT  EXECUTE ON FUNCTION increment_technician_offer_count(UUID, TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- HomeOps Migration 00003: Atomic Assignment & Serverless Batch Progression (v1.1)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Atomic Acceptance of Request Offer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_service_request_offer(
    p_request_id UUID,
    p_technician_id UUID,
    p_offer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated_rows INT;
    v_request RECORD;
    v_customer RECORD;
    v_technician RECORD;
BEGIN
    -- 1. Attempt atomic lock and assignment on the service request
    UPDATE service_requests
    SET 
        assigned_technician_id = p_technician_id,
        status = 'ASSIGNED',
        assigned_at = NOW(),
        batch_progression_status = 'IDLE'
    WHERE 
        id = p_request_id
        AND status = 'SEARCHING'
        AND assigned_technician_id IS NULL;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    IF v_updated_rows = 0 THEN
        -- Another technician won or request was cancelled/expired
        UPDATE request_offers
        SET offer_status = 'LOST_TO_ANOTHER_TECHNICIAN', responded_at = NOW()
        WHERE id = p_offer_id;

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'ALREADY_ASSIGNED_OR_CANCELLED'
        );
    END IF;

    -- 2. Mark winning offer as ACCEPTED
    UPDATE request_offers
    SET offer_status = 'ACCEPTED', responded_at = NOW()
    WHERE id = p_offer_id;

    -- 3. Invalidate all other active offers for this request
    UPDATE request_offers
    SET offer_status = 'LOST_TO_ANOTHER_TECHNICIAN', responded_at = NOW()
    WHERE service_request_id = p_request_id AND id != p_offer_id AND offer_status = 'SENT';

    -- 4. Record audit event
    INSERT INTO request_events (
        service_request_id,
        event_type,
        old_status,
        new_status,
        performed_by,
        notes
    )
    SELECT
        p_request_id,
        'ASSIGNED',
        'SEARCHING',
        'ASSIGNED',
        tp.profile_id,
        'Technician accepted offer atomically'
    FROM technician_profiles tp
    WHERE tp.id = p_technician_id;

    -- 5. Fetch full customer & technician details to setup relay conversation if needed
    SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;
    SELECT * INTO v_customer FROM profiles WHERE id = v_request.customer_id;
    SELECT tp.*, p.telegram_username, p.phone_number INTO v_technician 
    FROM technician_profiles tp
    JOIN profiles p ON p.id = tp.profile_id
    WHERE tp.id = p_technician_id;

    -- Insert relay record in assignment_conversations (guaranteed fallback)
    INSERT INTO assignment_conversations (
        service_request_id,
        customer_id,
        technician_id,
        relay_status
    ) VALUES (
        p_request_id,
        v_request.customer_id,
        v_technician.profile_id,
        'ACTIVE'
    ) ON CONFLICT (service_request_id) DO NOTHING;

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
-- Atomic Batch Claim and Advance for Scheduled Worker (Spec v1.1 Section 18.1)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_expired_search_requests(
    p_claim_timeout_seconds INT DEFAULT 120
)
RETURNS TABLE (
    request_id UUID,
    current_batch INT,
    service_category_id UUID,
    service_latitude NUMERIC,
    service_longitude NUMERIC,
    urgency urgency_level
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
          AND EXISTS (
              SELECT 1 FROM request_offers ro
              WHERE ro.service_request_id = sr.id
                AND ro.offer_status = 'SENT'
                AND ro.expires_at < NOW()
          )
          AND NOT EXISTS (
              SELECT 1 FROM request_offers ro
              WHERE ro.service_request_id = sr.id
                AND ro.offer_status = 'ACCEPTED'
          )
        FOR UPDATE SKIP LOCKED
    ),
    claimed_rows AS (
        UPDATE service_requests sr
        SET 
            batch_progression_status = 'PROCESSING',
            batch_progression_claimed_at = NOW()
        FROM expired_candidates ec
        WHERE sr.id = ec.id
        RETURNING sr.id, sr.current_offer_batch, sr.service_category_id, sr.service_latitude, sr.service_longitude, sr.urgency
    )
    SELECT 
        cr.id AS request_id,
        cr.current_offer_batch AS current_batch,
        cr.service_category_id,
        cr.service_latitude,
        cr.service_longitude,
        cr.urgency
    FROM claimed_rows cr;
END;
$$;

-- ----------------------------------------------------------------------------
-- Release or Finalize Batch Progression
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finalize_batch_progression(
    p_request_id UUID,
    p_new_batch INT,
    p_search_exhausted BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Expire any remaining SENT offers from previous batches
    UPDATE request_offers
    SET offer_status = 'EXPIRED'
    WHERE service_request_id = p_request_id AND offer_status = 'SENT';

    IF p_search_exhausted THEN
        UPDATE service_requests
        SET 
            status = 'NO_TECHNICIAN_FOUND',
            operator_review_required = TRUE,
            batch_progression_status = 'IDLE',
            batch_progression_claimed_at = NULL
        WHERE id = p_request_id;

        INSERT INTO request_events (
            service_request_id,
            event_type,
            old_status,
            new_status,
            notes
        ) VALUES (
            p_request_id,
            'SEARCH_EXHAUSTED',
            'SEARCHING',
            'NO_TECHNICIAN_FOUND',
            'All offer batches exhausted without acceptance. Escalated to operator review.'
        );
    ELSE
        UPDATE service_requests
        SET 
            current_offer_batch = p_new_batch,
            batch_progression_status = 'IDLE',
            batch_progression_claimed_at = NULL
        WHERE id = p_request_id;

        INSERT INTO request_events (
            service_request_id,
            event_type,
            notes
        ) VALUES (
            p_request_id,
            'BATCH_ADVANCED',
            'Advanced search to batch ' || p_new_batch
        );
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- Update Technician Metrics on Request Completion / Rating
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_technician_metrics(p_technician_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_completed INT;
    v_avg_rating NUMERIC(3, 2);
    v_probation probation_status;
BEGIN
    SELECT COUNT(*) INTO v_total_completed
    FROM service_requests
    WHERE assigned_technician_id = p_technician_id AND status = 'COMPLETED';

    SELECT COALESCE(ROUND(AVG(r.score)::NUMERIC, 2), 0.0) INTO v_avg_rating
    FROM ratings r
    JOIN service_requests sr ON sr.id = r.service_request_id
    WHERE sr.assigned_technician_id = p_technician_id;

    IF v_total_completed >= 5 THEN
        v_probation := 'COMPLETED';
    ELSE
        v_probation := 'ACTIVE';
    END IF;

    UPDATE technician_profiles
    SET 
        completed_request_count = v_total_completed,
        average_rating = v_avg_rating,
        probation_status = v_probation,
        updated_at = NOW()
    WHERE id = p_technician_id;
END;
$$;

-- ============================================================================
-- HomeOps Migration 00013: Re-matching after a technician drops a job
-- ============================================================================
-- A request re-opened because its technician cancelled already has offers, so the
-- "running search" branch of the claim would pick it up at once, even for a slot
-- tomorrow, and then find nobody available that far ahead. Now no request is
-- searched before its slot is within SEARCH.LEAD_TIME_HOURS; a re-opened scheduled
-- booking simply waits, then gets a fresh set of batches.
-- Same signature/return type as 00009, so CREATE OR REPLACE keeps the grants.

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
          -- never search before the slot is near (applies to new and re-opened bookings alike)
          AND sr.preferred_start_time <= NOW() + make_interval(hours => config_value('SEARCH.LEAD_TIME_HOURS', 2)::INT)
          -- and no offer is still waiting for an answer (none sent yet counts too)
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
    SELECT cr.id, cr.current_offer_batch, cr.service_category_id, cr.issue_type_id,
           cr.service_latitude, cr.service_longitude, cr.urgency, sc.name, it.name,
           cr.service_locality, cr.preferred_start_time, cr.preferred_end_time
    FROM claimed_rows cr
    JOIN service_categories sc ON sc.id = cr.service_category_id
    JOIN issue_types it ON it.id = cr.issue_type_id;
END;
$$;

-- ============================================================================
-- Fix: finalize_batch_progression expired EVERY sent offer, including the batch that was
-- just dispatched (runSearchBatch sends offers first, then finalizes). Technicians got an
-- offer that was already EXPIRED in the database, so Accept failed and the cron declared
-- the search exhausted. Only offers from earlier batches expire now.
-- ============================================================================

CREATE OR REPLACE FUNCTION finalize_batch_progression(
    p_request_id UUID,
    p_new_batch INT,
    p_search_exhausted BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Expire remaining SENT offers from previous batches (not the one just sent)
    UPDATE request_offers
    SET offer_status = 'EXPIRED'
    WHERE service_request_id = p_request_id AND offer_status = 'SENT' AND offer_batch < p_new_batch;

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

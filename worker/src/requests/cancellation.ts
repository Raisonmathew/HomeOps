import { SupabaseClient } from '@supabase/supabase-js';
import { logRequestEvent } from '../security/audit-events';
import { RequestStatus } from '../types/database';
import { canTransitionState } from './request-state-machine';
import { closeRelay } from './relay';
import { SEARCH_CONFIG } from '../config/constants';

/**
 * After a re-open: 'NOW' = the caller must run batch 1 immediately (runSearchBatch);
 * 'LATER' = scheduled slot beyond the lead time, the cron starts the search before the slot.
 */
export type Rematch = 'NOW' | 'LATER';

export interface CancellationResult {
  success: boolean;
  /** Technician dropped the job: the request is SEARCHING again */
  reopened: boolean;
  rematch?: Rematch;
  oldStatus: RequestStatus | null;
}

/** Statuses from which a request can go back to searching (technician hasn't started work). */
export const REOPENABLE_STATUSES: RequestStatus[] = ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED'];

/** Event types that mean "this request's technician was removed and the search re-opened". */
export const DROP_EVENT_TYPES = [
  'CANCELLED_BY_TECHNICIAN',
  'CUSTOMER_REQUESTED_ANOTHER_TECHNICIAN',
  'NO_CONTACT_REASSIGNED',
  'REASSIGNED_BY_OPERATOR',
  'TECHNICIAN_SUSPENDED',
];

/**
 * Puts an assigned request back into search without its technician (technician cancelled,
 * no contact, or the customer asked for someone else, spec §9.4/§13). The dropped technician is
 * recorded (metadata.dropped_technician_id) so the re-match never offers them this job again.
 * Returns null if the request can't be re-opened from its current status.
 */
export async function reopenSearch(
  supabase: SupabaseClient,
  requestId: string,
  byProfileId: string | null,
  eventType: 'CANCELLED_BY_TECHNICIAN' | 'CUSTOMER_REQUESTED_ANOTHER_TECHNICIAN' | 'NO_CONTACT_REASSIGNED' | 'TECHNICIAN_SUSPENDED',
  notes: string,
  fromStatuses: RequestStatus[] = REOPENABLE_STATUSES,
  metadata: Record<string, unknown> | null = null
): Promise<Rematch | null> {
  const { data: current } = await supabase
    .from('service_requests')
    .select('status, assigned_technician_id, preferred_start_time')
    .eq('id', requestId)
    .single();
  const oldStatus = current?.status as RequestStatus | undefined;
  if (!current || !oldStatus || !fromStatuses.includes(oldStatus)) return null;

  // A booking for later keeps its slot: the cron searches SEARCH.LEAD_TIME_HOURS before it (migration 00013).
  const rematch: Rematch =
    new Date(current.preferred_start_time).getTime() > Date.now() + SEARCH_CONFIG.LEAD_TIME_HOURS * 3600_000 ? 'LATER' : 'NOW';

  const { data: reopened } = await supabase
    .from('service_requests')
    .update({
      status: 'SEARCHING',
      assigned_technician_id: null,
      assigned_at: null,
      start_pin: null,
      start_pin_attempts: 0,
      current_offer_batch: 0, // a fresh set of batches for the re-match
      // NOW: PROCESSING keeps the cron out until the caller's runSearchBatch finalizes. LATER: the cron owns it.
      batch_progression_status: rematch === 'NOW' ? 'PROCESSING' : 'IDLE',
      batch_progression_claimed_at: rematch === 'NOW' ? new Date().toISOString() : null,
    })
    .eq('id', requestId)
    .eq('status', oldStatus)
    .select('id');
  if (!reopened?.length) return null;

  // The accepted offer would otherwise block batch progression forever.
  await supabase.from('request_offers').update({ offer_status: 'CANCELLED' }).eq('service_request_id', requestId).eq('offer_status', 'ACCEPTED');
  await closeRelay(supabase, requestId);

  // Second drop on the same request: the automatic loop isn't working for this customer; get a human involved.
  const { count: previousDrops } = await supabase
    .from('request_events')
    .select('id', { count: 'exact', head: true })
    .eq('service_request_id', requestId)
    .eq('new_status', 'SEARCHING')
    .in('event_type', DROP_EVENT_TYPES);
  if ((previousDrops ?? 0) >= 1) {
    await supabase.from('service_requests').update({ operator_review_required: true }).eq('id', requestId);
  }

  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType,
    oldStatus,
    newStatus: 'SEARCHING',
    performedBy: byProfileId,
    notes: `${notes}. Re-opening search${rematch === 'LATER' ? ' before the booked slot' : ''}.`,
    metadata: { ...(metadata ?? {}), dropped_technician_id: current.assigned_technician_id },
  });
  return rematch;
}

export async function cancelServiceRequest(
  supabase: SupabaseClient,
  requestId: string,
  cancelledByProfileId: string,
  cancelledByRole: 'CUSTOMER' | 'TECHNICIAN' | 'OPERATOR',
  reason?: string,
  reasonCode?: string
): Promise<CancellationResult> {
  const { data: current } = await supabase.from('service_requests').select('status').eq('id', requestId).single();
  const oldStatus = (current?.status as RequestStatus) ?? null;
  if (!oldStatus) return { success: false, reopened: false, oldStatus };

  // A technician backing out before work starts never strands the customer: the search re-opens (spec §13).
  if (cancelledByRole === 'TECHNICIAN') {
    const rematch = await reopenSearch(
      supabase,
      requestId,
      cancelledByProfileId,
      'CANCELLED_BY_TECHNICIAN',
      `Technician cancelled: ${reason || 'No reason provided'}`,
      REOPENABLE_STATUSES,
      { reason: reasonCode ?? null }
    );
    return { success: !!rematch, reopened: !!rematch, rematch: rematch ?? undefined, oldStatus };
  }

  const newStatus: RequestStatus = cancelledByRole === 'CUSTOMER' ? 'CANCELLED_BY_CUSTOMER' : 'CANCELLED_BY_OPERATOR';

  if (!canTransitionState(oldStatus, newStatus, cancelledByRole)) {
    return { success: false, reopened: false, oldStatus };
  }

  // Guarded on the status we checked, so a concurrent accept/complete can't be overwritten.
  const { data: updated, error } = await supabase
    .from('service_requests')
    .update({ status: newStatus, batch_progression_status: 'IDLE' })
    .eq('id', requestId)
    .eq('status', oldStatus)
    .select('id');
  if (error || !updated?.length) return { success: false, reopened: false, oldStatus };

  // Offers still out are void (spec §13: customer cancellation while offers are active).
  await supabase
    .from('request_offers')
    .update({ offer_status: 'CANCELLED' })
    .eq('service_request_id', requestId)
    .in('offer_status', ['SENT', 'VIEWED']);
  await closeRelay(supabase, requestId);

  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: newStatus,
    oldStatus,
    newStatus,
    performedBy: cancelledByProfileId,
    notes: reason || null,
    // "late" = the technician had already contacted the customer; counted toward customer strikes
    metadata: { reason: reasonCode ?? null, late: cancelledByRole === 'CUSTOMER' && ['CONTACTED', 'DISCUSSING_SCOPE'].includes(oldStatus) },
  });

  return { success: true, reopened: false, oldStatus };
}

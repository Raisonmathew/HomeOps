import { SupabaseClient } from '@supabase/supabase-js';
import { logRequestEvent } from '../security/audit-events';
import { RequestStatus } from '../types/database';

export async function cancelServiceRequest(
  supabase: SupabaseClient,
  requestId: string,
  cancelledByProfileId: string,
  cancelledByRole: 'CUSTOMER' | 'TECHNICIAN' | 'OPERATOR',
  reason?: string
): Promise<{ success: boolean; shouldReOffer: boolean }> {
  let newStatus: RequestStatus;

  if (cancelledByRole === 'CUSTOMER') {
    newStatus = 'CANCELLED_BY_CUSTOMER';
  } else if (cancelledByRole === 'TECHNICIAN') {
    newStatus = 'CANCELLED_BY_TECHNICIAN';
  } else {
    newStatus = 'CANCELLED_BY_OPERATOR';
  }

  // If technician cancels after acceptance, request can return to SEARCHING
  if (cancelledByRole === 'TECHNICIAN') {
    const { data: currentReq } = await supabase
      .from('service_requests')
      .select('status, assigned_technician_id')
      .eq('id', requestId)
      .single();

    if (currentReq && currentReq.status === 'ASSIGNED') {
      await supabase
        .from('service_requests')
        .update({
          status: 'SEARCHING',
          assigned_technician_id: null,
          assigned_at: null,
        })
        .eq('id', requestId);

      await logRequestEvent(supabase, {
        serviceRequestId: requestId,
        eventType: 'CANCELLED_BY_TECHNICIAN',
        oldStatus: 'ASSIGNED',
        newStatus: 'SEARCHING',
        performedBy: cancelledByProfileId,
        notes: `Technician cancelled assignment: ${reason || 'No reason provided'}. Re-opening search.`,
      });

      return { success: true, shouldReOffer: true };
    }
  }

  // Capture the current status before updating so the audit trail is complete (#11)
  const { data: currentReq } = await supabase
    .from('service_requests')
    .select('status')
    .eq('id', requestId)
    .single();

  const oldStatus = (currentReq?.status as RequestStatus) ?? null;

  const { error } = await supabase
    .from('service_requests')
    .update({ status: newStatus })
    .eq('id', requestId);

  if (error) return { success: false, shouldReOffer: false };

  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: newStatus,
    oldStatus,     // #11: was missing
    newStatus,
    performedBy: cancelledByProfileId,
    notes: reason || null,
  });

  return { success: true, shouldReOffer: false };
}

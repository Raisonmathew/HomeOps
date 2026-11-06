import { SupabaseClient } from '@supabase/supabase-js';
import { logRequestEvent } from '../security/audit-events';
import { closeRelay } from './relay';

export async function markTechnicianComplete(
  supabase: SupabaseClient,
  requestId: string,
  technicianProfileId: string
): Promise<boolean> {
  // Step 1: IN_PROGRESS → TECHNICIAN_MARKED_COMPLETE (spec §6.8 lifecycle)
  const { error: step1Error } = await supabase
    .from('service_requests')
    .update({ status: 'TECHNICIAN_MARKED_COMPLETE' })
    .eq('id', requestId)
    .eq('status', 'IN_PROGRESS');

  if (step1Error) return false;

  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: 'TECHNICIAN_MARKED_COMPLETE',
    oldStatus: 'IN_PROGRESS',
    newStatus: 'TECHNICIAN_MARKED_COMPLETE',
    performedBy: technicianProfileId,
    notes: 'Technician declared work completed',
  });

  // Step 2: TECHNICIAN_MARKED_COMPLETE → CUSTOMER_CONFIRMATION_PENDING
  const { error: step2Error } = await supabase
    .from('service_requests')
    .update({ status: 'CUSTOMER_CONFIRMATION_PENDING' })
    .eq('id', requestId)
    .eq('status', 'TECHNICIAN_MARKED_COMPLETE');

  if (step2Error) return false;

  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: 'CUSTOMER_CONFIRMATION_PENDING',
    oldStatus: 'TECHNICIAN_MARKED_COMPLETE',
    newStatus: 'CUSTOMER_CONFIRMATION_PENDING',
    performedBy: technicianProfileId,
    notes: 'Awaiting customer confirmation',
  });

  return true;
}

export async function confirmCustomerCompletion(
  supabase: SupabaseClient,
  requestId: string,
  customerProfileId: string,
  isPartial = false
): Promise<boolean> {
  const newStatus = isPartial ? 'PARTIALLY_COMPLETED' : 'COMPLETED';

  const { data: request, error } = await supabase
    .from('service_requests')
    .update({
      status: newStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'CUSTOMER_CONFIRMATION_PENDING') // only after the technician marked it complete
    .select('assigned_technician_id')
    .single();

  if (error || !request) return false;
  await closeRelay(supabase, requestId);

  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: newStatus,
    oldStatus: 'CUSTOMER_CONFIRMATION_PENDING',
    newStatus,
    performedBy: customerProfileId,
    notes: isPartial ? 'Customer confirmed partial completion' : 'Customer confirmed full completion',
  });

  // Trigger metrics recalculation for technician
  if (request.assigned_technician_id) {
    await supabase.rpc('update_technician_metrics', {
      p_technician_id: request.assigned_technician_id,
    });
  }

  return true;
}

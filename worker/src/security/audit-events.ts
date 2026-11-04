import { SupabaseClient } from '@supabase/supabase-js';
import { RequestStatus } from '../types/database';

export async function logRequestEvent(
  supabase: SupabaseClient,
  params: {
    serviceRequestId: string;
    eventType: string;
    oldStatus?: RequestStatus | null;
    newStatus?: RequestStatus | null;
    performedBy?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  const { error } = await supabase.from('request_events').insert({
    service_request_id: params.serviceRequestId,
    event_type: params.eventType,
    old_status: params.oldStatus,
    new_status: params.newStatus,
    performed_by: params.performedBy,
    notes: params.notes,
    metadata: params.metadata,
  });

  // A failed audit write must not be silently swallowed (#23).
  // Log the error so operators can identify gaps in the immutable event trail.
  if (error) {
    console.error(
      `[audit] Failed to write request event "${params.eventType}" for request ${params.serviceRequestId}:`,
      error.message
    );
  }
}

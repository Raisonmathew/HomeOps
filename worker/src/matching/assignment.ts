import { SupabaseClient } from '@supabase/supabase-js';

export interface AtomicAssignmentResult {
  success: boolean;
  reason?: string;
  requestId?: string;
  requestNumber?: string;
  serviceAddressText?: string;
  serviceLatitude?: number;
  serviceLongitude?: number;
  description?: string;
}

export async function processAtomicAssignment(
  supabase: SupabaseClient,
  requestId: string,
  technicianId: string,
  offerId: string
): Promise<AtomicAssignmentResult> {
  const { data, error } = await supabase.rpc('accept_service_request_offer', {
    p_request_id: requestId,
    p_technician_id: technicianId,
    p_offer_id: offerId,
  });

  if (error || !data) {
    console.error('Error invoking atomic assignment stored procedure:', error);
    return {
      success: false,
      reason: error?.message || 'DATABASE_ERROR',
    };
  }

  const result = data as {
    success: boolean;
    reason?: string;
    request_id?: string;
    request_number?: string;
    service_address_text?: string;
    service_latitude?: number;
    service_longitude?: number;
    description?: string;
  };

  return {
    success: result.success,
    reason: result.reason,
    requestId: result.request_id,
    requestNumber: result.request_number,
    serviceAddressText: result.service_address_text,
    serviceLatitude: result.service_latitude,
    serviceLongitude: result.service_longitude,
    description: result.description,
  };
}

import { SupabaseClient } from '@supabase/supabase-js';

export async function submitComplaint(
  supabase: SupabaseClient,
  params: {
    serviceRequestId: string;
    reportedByProfileId: string;
    reportedAgainstProfileId: string;
    complaintType: string;
    description: string;
  }
): Promise<boolean> {
  const { error } = await supabase.from('complaints').insert({
    service_request_id: params.serviceRequestId,
    reported_by: params.reportedByProfileId,
    reported_against: params.reportedAgainstProfileId,
    complaint_type: params.complaintType,
    description: params.description,
    status: 'OPEN',
  });

  return !error;
}

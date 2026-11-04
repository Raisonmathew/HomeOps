import { SupabaseClient } from '@supabase/supabase-js';

export interface EstimateInput {
  serviceRequestId: string;
  recordedByProfileId: string;
  visitCharge: number;
  labourAmount: number;
  partsAmount: number;
  warrantyText?: string;
}

export async function recordEstimate(
  supabase: SupabaseClient,
  input: EstimateInput
): Promise<boolean> {
  const estimatedTotal = input.visitCharge + input.labourAmount + input.partsAmount;

  const { error } = await supabase.from('estimate_records').insert({
    service_request_id: input.serviceRequestId,
    recorded_by: input.recordedByProfileId,
    visit_charge: input.visitCharge,
    labour_amount: input.labourAmount,
    parts_amount: input.partsAmount,
    estimated_total: estimatedTotal,
    warranty_text: input.warrantyText || null,
    customer_acknowledgement_status: 'NOT_REVIEWED',
  });

  return !error;
}

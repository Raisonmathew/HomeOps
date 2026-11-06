import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Raises a system flag for operators. Flags reuse the complaints queue (reported_by = NULL,
 * complaint_type "AUTO: ...") so they appear on the dashboard's Complaints page.
 * At most one open flag per request + type + person.
 */
export async function raiseFlag(
  supabase: SupabaseClient,
  flag: { requestId: string; againstProfileId: string; type: string; details: string; needsReview?: boolean }
): Promise<void> {
  const complaintType = `AUTO: ${flag.type}`;
  const { data: existing } = await supabase
    .from('complaints')
    .select('id')
    .eq('service_request_id', flag.requestId)
    .eq('reported_against', flag.againstProfileId)
    .eq('complaint_type', complaintType)
    .limit(1);
  if (existing?.length) return;

  const { error } = await supabase.from('complaints').insert({
    service_request_id: flag.requestId,
    reported_by: null,
    reported_against: flag.againstProfileId,
    complaint_type: complaintType,
    description: flag.details,
    status: 'OPEN',
  });
  if (error) console.error(`Failed to raise flag ${flag.type}:`, error);
  if (flag.needsReview) {
    await supabase.from('service_requests').update({ operator_review_required: true }).eq('id', flag.requestId);
  }
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600_000).toISOString();

/** Late cancellations (after the technician made contact) plus no-shows, last 30 days. */
export async function customerReliabilityStrikes(supabase: SupabaseClient, customerProfileId: string): Promise<number> {
  const [{ count: lateCancels }, { count: noShows }] = await Promise.all([
    supabase
      .from('request_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'CANCELLED_BY_CUSTOMER')
      .eq('performed_by', customerProfileId)
      .eq('metadata->>late', 'true')
      .gte('created_at', daysAgo(30)),
    supabase
      .from('service_requests')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerProfileId)
      .eq('closure_reason', 'CUSTOMER_NOT_AVAILABLE')
      .gte('created_at', daysAgo(30)),
  ]);
  return (lateCancels ?? 0) + (noShows ?? 0);
}

/** Technician cancellations of accepted jobs in the last 7 days. */
export async function technicianCancelsThisWeek(supabase: SupabaseClient, technicianProfileId: string): Promise<number> {
  const { count } = await supabase
    .from('request_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'CANCELLED_BY_TECHNICIAN')
    .eq('performed_by', technicianProfileId)
    .gte('created_at', daysAgo(7));
  return count ?? 0;
}

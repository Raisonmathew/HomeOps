import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Average score and count of ratings a profile has received (both directions use the same table).
 * Only confirmed jobs count: a rating left on a fake or disputed completion is held until an
 * operator resolves it, so it can't be used to farm or retaliate.
 */
export async function getProfileRating(supabase: SupabaseClient, profileId: string): Promise<{ avg: number; count: number }> {
  const { data } = await supabase
    .from('ratings')
    .select('score, service_request:service_requests!inner(status)')
    .eq('reviewed_profile_id', profileId)
    .in('service_request.status', ['COMPLETED', 'PARTIALLY_COMPLETED']);
  const scores = (data ?? []).map((r) => r.score as number);
  return { avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0, count: scores.length };
}

export async function submitRating(
  supabase: SupabaseClient,
  params: {
    serviceRequestId: string;
    reviewerProfileId: string;
    reviewedProfileId: string;
    score: number;
    comment?: string;
  }
): Promise<boolean> {
  const { error } = await supabase.from('ratings').insert({
    service_request_id: params.serviceRequestId,
    reviewer_id: params.reviewerProfileId,
    reviewed_profile_id: params.reviewedProfileId,
    score: Math.max(1, Math.min(5, Math.round(params.score))),
    comment: params.comment || null,
  });

  return !error;
}

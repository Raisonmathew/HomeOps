import { SupabaseClient } from '@supabase/supabase-js';

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

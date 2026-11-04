import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { dispatchOfferBatch } from './offer-batches';
import { rankCandidate, sortCandidatesWithFairRotation } from './ranking';
import { evaluateEligibility } from './eligibility-filter';
import { CandidateTechnician, ScoredCandidate } from '../types/matching';
import { UrgencyLevel, ProbationStatus, VerificationStatus } from '../types/database';

export interface BatchProgressionResult {
  claimedRequests: number;
  advancedCount: number;
  exhaustedCount: number;
}

/** Shape of a row returned by the technician_availability join query. */
interface AvailabilityRow {
  technician_id: string;
  current_latitude: number;
  current_longitude: number;
  effective_radius_km: number;
  location_expires_at: string;
  technician_profiles: {
    id: string;
    profile_id: string;
    verification_status: VerificationStatus;
    average_rating: number;
    completed_request_count: number;
    acceptance_rate: number;
    completion_rate: number;
    post_acceptance_cancellation_rate: number;
    complaint_rate: number;
    probation_status: ProbationStatus;
    last_offered_at: string | null;
    recent_offer_count_7d: number;
    recent_assignment_count_30d: number;
    created_at: string;
    profiles: {
      telegram_user_id: number;
      full_name: string;
      phone_number: string | null;
      account_status: string;
    };
  };
}

export async function processExpiredBatches(
  supabase: SupabaseClient,
  messageSender: MessageSender
): Promise<BatchProgressionResult> {
  // 1. Claim expired search requests atomically
  const { data: claimed, error } = await supabase.rpc('claim_expired_search_requests', {
    p_claim_timeout_seconds: 120,
  });

  if (error || !claimed || claimed.length === 0) {
    return { claimedRequests: 0, advancedCount: 0, exhaustedCount: 0 };
  }

  let advancedCount = 0;
  let exhaustedCount = 0;

  for (const req of claimed) {
    const nextBatch = (req.current_batch || 1) + 1;

    // Check if we reached the end of batch progression (Batch 3 maximum)
    if (nextBatch > 3) {
      await supabase.rpc('finalize_batch_progression', {
        p_request_id: req.request_id,
        p_new_batch: nextBatch,
        p_search_exhausted: true,
      });
      exhaustedCount++;
      continue;
    }

    // Fetch all ONLINE technicians who haven't already received an offer for this request. (#13)
    const { data: activeTechs } = await supabase
      .from('technician_availability')
      .select(`
        technician_id,
        current_latitude,
        current_longitude,
        effective_radius_km,
        location_expires_at,
        technician_profiles!inner (
          id,
          profile_id,
          verification_status,
          average_rating,
          completed_request_count,
          acceptance_rate,
          completion_rate,
          post_acceptance_cancellation_rate,
          complaint_rate,
          probation_status,
          last_offered_at,
          recent_offer_count_7d,
          recent_assignment_count_30d,
          created_at,
          profiles!inner (
            telegram_user_id,
            full_name,
            phone_number,
            account_status
          )
        )
      `)
      .eq('availability_status', 'ONLINE');

    // Batch-fetch everything needed to filter candidates — 4 queries total, no N+1 (#13)
    const techIds = (activeTechs || []).map((t) => t.technician_id);
    let exactSkillSet = new Set<string>();
    let categorySkillSet = new Set<string>();
    let alreadyOfferedSet = new Set<string>();
    /** technician_id → count of active (in-flight) assignments (#2) */
    const activeAssignmentCounts = new Map<string, number>();

    if (techIds.length > 0) {
      // Exact-skill: approved for both the category AND the specific issue type (#1)
      const { data: exactSkills } = await supabase
        .from('technician_skills')
        .select('technician_id')
        .in('technician_id', techIds)
        .eq('service_category_id', req.service_category_id)
        .eq('issue_type_id', req.issue_type_id)
        .eq('approval_status', 'APPROVED');

      // Category-skill: approved for the category (issue_type_id may be null or different) (#1)
      const { data: categorySkills } = await supabase
        .from('technician_skills')
        .select('technician_id')
        .in('technician_id', techIds)
        .eq('service_category_id', req.service_category_id)
        .eq('approval_status', 'APPROVED');

      // Technicians who already received an offer for this request — exclude them (#13)
      const { data: existingOffers } = await supabase
        .from('request_offers')
        .select('technician_id')
        .eq('service_request_id', req.request_id)
        .in('technician_id', techIds);

      // Active assignment counts per technician — fixes the hardcoded 0 (#2)
      const { data: activeAssignments } = await supabase
        .from('service_requests')
        .select('assigned_technician_id')
        .in('assigned_technician_id', techIds)
        .in('status', [
          'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS',
        ]);

      exactSkillSet = new Set((exactSkills || []).map((s) => s.technician_id));
      categorySkillSet = new Set((categorySkills || []).map((s) => s.technician_id));
      alreadyOfferedSet = new Set((existingOffers || []).map((o) => o.technician_id));
      for (const row of activeAssignments || []) {
        const id = row.assigned_technician_id as string;
        activeAssignmentCounts.set(id, (activeAssignmentCounts.get(id) ?? 0) + 1);
      }
    }

    const candidates: ScoredCandidate[] = [];

    for (const tech of (activeTechs || []) as unknown as AvailabilityRow[]) {
      // Skip technicians already offered this request (#13)
      if (alreadyOfferedSet.has(tech.technician_id)) continue;

      const tp = tech.technician_profiles;
      const p = tp.profiles;

      const candidate: CandidateTechnician = {
        technician_id: tech.technician_id,
        profile_id: tp.profile_id,
        telegram_user_id: p.telegram_user_id,
        full_name: p.full_name,
        phone_number: p.phone_number,
        account_status: p.account_status,
        verification_status: tp.verification_status,
        current_latitude: tech.current_latitude,
        current_longitude: tech.current_longitude,
        effective_radius_km: tech.effective_radius_km,
        location_expires_at: tech.location_expires_at,
        // Populated from DB, not hardcoded (#2)
        active_assignments_count: activeAssignmentCounts.get(tech.technician_id) ?? 0,
        average_rating: tp.average_rating,
        completed_request_count: tp.completed_request_count,
        acceptance_rate: tp.acceptance_rate,
        completion_rate: tp.completion_rate,
        post_acceptance_cancellation_rate: tp.post_acceptance_cancellation_rate,
        complaint_rate: tp.complaint_rate,
        probation_status: tp.probation_status,
        last_offered_at: tp.last_offered_at,
        recent_offer_count_7d: tp.recent_offer_count_7d || 0,
        recent_assignment_count_30d: tp.recent_assignment_count_30d || 0,
        created_at: tp.created_at,
        has_exact_skill: exactSkillSet.has(tech.technician_id),     // #1
        has_category_skill: categorySkillSet.has(tech.technician_id), // #1
      };

      const eligibility = evaluateEligibility(candidate, req.service_latitude, req.service_longitude);
      if (eligibility.eligible) {
        const scored = rankCandidate(candidate, eligibility.distance_km);
        candidates.push(scored);
      }
    }

    const sortedCandidates = sortCandidatesWithFairRotation(candidates, req.urgency as UrgencyLevel);

    if (sortedCandidates.length === 0) {
      await supabase.rpc('finalize_batch_progression', {
        p_request_id: req.request_id,
        p_new_batch: nextBatch,
        p_search_exhausted: true,
      });
      exhaustedCount++;
    } else {
      const dispatched = await dispatchOfferBatch(
        supabase,
        messageSender,
        req.request_id,
        nextBatch,
        sortedCandidates,
        {
          // Use actual request data instead of hardcoded placeholders (#19)
          categoryName: req.category_name || 'Home Service',
          issueName: req.issue_name || 'Service Request',
          serviceArea: req.service_area || 'Customer Locality',
          hasPhoto: !!req.has_photo,
        }
      );

      await supabase.rpc('finalize_batch_progression', {
        p_request_id: req.request_id,
        p_new_batch: nextBatch,
        p_search_exhausted: dispatched === 0,
      });

      if (dispatched > 0) advancedCount++;
      else exhaustedCount++;
    }
  }

  return {
    claimedRequests: claimed.length,
    advancedCount,
    exhaustedCount,
  };
}

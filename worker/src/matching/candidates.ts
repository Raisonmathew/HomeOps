import { SupabaseClient } from '@supabase/supabase-js';
import { rankCandidate, sortCandidatesWithFairRotation } from './ranking';
import { evaluateEligibility } from './eligibility-filter';
import { CandidateTechnician, ScoredCandidate } from '../types/matching';
import { UrgencyLevel, ProbationStatus, VerificationStatus } from '../types/database';
import { DROP_EVENT_TYPES } from '../requests/cancellation';

/** Everything the search needs about a request (initial dispatch, batch progression, re-search). */
export interface SearchRequest {
  id: string;
  service_category_id: string;
  issue_type_id: string;
  service_latitude: number;
  service_longitude: number;
  urgency: UrgencyLevel;
  category_name: string;
  issue_name: string;
  service_locality: string | null;
  preferred_start_time: string;
  preferred_end_time: string;
}

/** service_requests columns (+ names) needed to build a SearchRequest with toSearchRequest(). */
export const SEARCH_FIELDS =
  'id, request_number, status, service_category_id, issue_type_id, service_latitude, service_longitude, urgency, ' +
  'service_locality, service_address_text, preferred_start_time, preferred_end_time, ' +
  'category:service_categories(name), issue:issue_types(name)';

export function toSearchRequest(row: any): SearchRequest {
  return {
    id: row.id,
    service_category_id: row.service_category_id,
    issue_type_id: row.issue_type_id,
    service_latitude: Number(row.service_latitude),
    service_longitude: Number(row.service_longitude),
    urgency: row.urgency,
    category_name: row.category?.name ?? 'Home service',
    issue_name: row.issue?.name ?? 'Service request',
    service_locality: row.service_locality ?? null,
    preferred_start_time: row.preferred_start_time,
    preferred_end_time: row.preferred_end_time,
  };
}

/**
 * Which technicians who were already offered this request may be offered it again.
 * Normally none (each batch reaches new people). After the request lost its technician
 * (lastDropAt > 0), offers made *before* that drop which were lost to the departed winner or
 * simply expired get another chance; "lost" ones tried to accept, so they're asked first.
 * Declined offers, and anything offered after the drop, stay excluded.
 */
export function classifyPriorOffers(
  offers: { technician_id: string; offer_status: string; offered_at: string }[],
  lastDropAt: number
): { excluded: Set<string>; previouslyInterested: Set<string> } {
  const excluded = new Set<string>();
  const previouslyInterested = new Set<string>();
  for (const o of offers) {
    const beforeDrop = lastDropAt > 0 && new Date(o.offered_at).getTime() < lastDropAt;
    if (beforeDrop && (o.offer_status === 'LOST_TO_ANOTHER_TECHNICIAN' || o.offer_status === 'EXPIRED')) {
      if (o.offer_status === 'LOST_TO_ANOTHER_TECHNICIAN') previouslyInterested.add(o.technician_id);
    } else {
      excluded.add(o.technician_id);
    }
  }
  return { excluded, previouslyInterested };
}

/** Shape of a row returned by the technician_availability join query. */
interface AvailabilityRow {
  technician_id: string;
  current_latitude: number;
  current_longitude: number;
  effective_radius_km: number;
  location_expires_at: string;
  available_until: string;
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

/**
 * Eligible technicians for a request, ranked with fair rotation (spec §6.5, §18.3).
 * Technicians who were already offered this request are excluded, so the result is
 * exactly the pool for the next batch.
 */
export async function findCandidates(supabase: SupabaseClient, req: SearchRequest): Promise<ScoredCandidate[]> {
  const { data: activeTechs, error } = await supabase
    .from('technician_availability')
    .select(`
      technician_id,
      current_latitude,
      current_longitude,
      effective_radius_km,
      location_expires_at,
      available_until,
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
        profiles!technician_profiles_profile_id_fkey!inner (
          telegram_user_id,
          full_name,
          phone_number,
          account_status
        )
      )
    `)
    .eq('availability_status', 'ONLINE')
    .gt('location_expires_at', new Date().toISOString());

  if (error) {
    console.error('Failed to load online technicians:', error);
    return [];
  }

  const techIds = (activeTechs || []).map((t) => t.technician_id);
  if (techIds.length === 0) return [];

  // A technician must never be offered their own request (self-booking to farm jobs/ratings).
  const { data: reqOwner } = await supabase.from('service_requests').select('customer_id').eq('id', req.id).single();
  const customerProfileId = reqOwner?.customer_id as string | undefined;

  // Batch-fetch everything needed to filter candidates: 4 queries, no N+1
  const [exactSkills, categorySkills, existingOffers, activeAssignments, drops] = await Promise.all([
    supabase
      .from('technician_skills')
      .select('technician_id')
      .in('technician_id', techIds)
      .eq('service_category_id', req.service_category_id)
      .eq('issue_type_id', req.issue_type_id)
      .eq('approval_status', 'APPROVED'),
    supabase
      .from('technician_skills')
      .select('technician_id')
      .in('technician_id', techIds)
      .eq('service_category_id', req.service_category_id)
      .eq('approval_status', 'APPROVED'),
    supabase.from('request_offers').select('technician_id, offer_status, offered_at').eq('service_request_id', req.id).in('technician_id', techIds),
    supabase
      .from('service_requests')
      .select('assigned_technician_id')
      .in('assigned_technician_id', techIds)
      .in('status', ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS']),
    // Times this request lost its technician (cancel, no contact, customer request, operator reassign)
    supabase.from('request_events').select('created_at, metadata').eq('service_request_id', req.id).in('event_type', DROP_EVENT_TYPES),
  ]);

  // Never re-offer a technician who dropped this request, however they were assigned.
  const droppedSet = new Set((drops.data || []).map((e: any) => e.metadata?.dropped_technician_id).filter(Boolean) as string[]);
  const lastDropAt = Math.max(0, ...(drops.data || []).map((e: any) => new Date(e.created_at).getTime()));

  const exactSkillSet = new Set((exactSkills.data || []).map((s) => s.technician_id));
  const categorySkillSet = new Set((categorySkills.data || []).map((s) => s.technician_id));
  const { excluded: alreadyOfferedSet, previouslyInterested } = classifyPriorOffers(existingOffers.data || [], lastDropAt);
  const activeAssignmentCounts = new Map<string, number>();
  for (const row of activeAssignments.data || []) {
    const id = row.assigned_technician_id as string;
    activeAssignmentCounts.set(id, (activeAssignmentCounts.get(id) ?? 0) + 1);
  }

  const candidates: ScoredCandidate[] = [];
  const seen = new Set<string>(); // a technician can have several availability rows

  for (const tech of (activeTechs || []) as unknown as AvailabilityRow[]) {
    if (alreadyOfferedSet.has(tech.technician_id) || droppedSet.has(tech.technician_id) || seen.has(tech.technician_id)) continue;
    seen.add(tech.technician_id);

    const tp = tech.technician_profiles;
    const p = tp.profiles;
    if (tp.profile_id === customerProfileId) continue;

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
      available_until: tech.available_until,
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
      has_exact_skill: exactSkillSet.has(tech.technician_id),
      has_category_skill: categorySkillSet.has(tech.technician_id),
    };

    const eligibility = evaluateEligibility(candidate, req.service_latitude, req.service_longitude, req.preferred_start_time);
    if (eligibility.eligible) {
      candidates.push(rankCandidate(candidate, eligibility.distance_km));
    }
  }

  const ranked = sortCandidatesWithFairRotation(candidates, req.urgency);
  // Technicians who tried to accept before the previous winner dropped out are asked first.
  return [
    ...ranked.filter((c) => previouslyInterested.has(c.technician.technician_id)),
    ...ranked.filter((c) => !previouslyInterested.has(c.technician.technician_id)),
  ];
}

import { CandidateTechnician, ScoredCandidate } from '../types/matching';
import { MATCHING_WEIGHTS } from '../config/constants';
import { UrgencyLevel } from '../types/database';

export function rankCandidate(
  technician: CandidateTechnician,
  distanceKm: number
): ScoredCandidate {
  // 1. Skill Fit (Exact = 1.0, Category = 0.8)
  const skill_fit = technician.has_exact_skill ? 1.0 : technician.has_category_skill ? 0.8 : 0.0;

  // 2. Proximity factor: 1 - (distance / radius), clamped [0, 1]
  const rawProximity = 1 - distanceKm / Math.max(technician.effective_radius_km, 1);
  const proximity = Math.max(0, Math.min(1, rawProximity));

  // 3. Time availability (V1 default overlap = 1.0)
  const time_availability = 1.0;

  // 4. Reliability factor
  const completionRate = technician.completion_rate;
  const cancellationInverse = 1 - technician.post_acceptance_cancellation_rate;
  const complaintInverse = 1 - technician.complaint_rate;
  const reliability =
    completionRate * 0.5 + cancellationInverse * 0.3 + complaintInverse * 0.2;

  // 5. Rating factor (0 jobs: 0.70; 1-4 jobs: weighted; 5+ jobs: avg / 5)
  let rating = 0.7;
  if (technician.completed_request_count >= 5) {
    rating = Math.min(1, technician.average_rating / 5);
  } else if (technician.completed_request_count > 0) {
    const raw = technician.average_rating / 5;
    rating = 0.7 * (1 - technician.completed_request_count / 5) + raw * (technician.completed_request_count / 5);
  }

  // 6. Fairness factor — rewards technicians who have received few recent offers.
  // Probation status is intentionally NOT scored here; it only influences the
  // deterministic sort order (step 5 of sortCandidatesWithFairRotation) so that
  // it never overrides skill, distance, reliability, or rating differences (#21).
  let fairness = 0.5;
  if (technician.recent_offer_count_7d === 0) fairness += 0.5;
  else if (technician.recent_offer_count_7d <= 2) fairness += 0.3;
  fairness = Math.min(1, fairness);

  // Total weighted score (0 - 100)
  const rawMatchScore =
    skill_fit * MATCHING_WEIGHTS.SKILL_FIT +
    proximity * MATCHING_WEIGHTS.PROXIMITY +
    time_availability * MATCHING_WEIGHTS.TIME_AVAILABILITY +
    reliability * MATCHING_WEIGHTS.RELIABILITY +
    rating * MATCHING_WEIGHTS.RATING +
    fairness * MATCHING_WEIGHTS.FAIRNESS;

  const match_score = Math.round(rawMatchScore * 10) / 10;
  const score_band = Math.floor(match_score / 5) * 5;

  const explanation = {
    match_score,
    score_band,
    factors: {
      skill_fit: { raw: skill_fit, weighted: skill_fit * MATCHING_WEIGHTS.SKILL_FIT },
      proximity: { raw: proximity, distance_km: distanceKm, weighted: proximity * MATCHING_WEIGHTS.PROXIMITY },
      time_availability: { raw: time_availability, weighted: time_availability * MATCHING_WEIGHTS.TIME_AVAILABILITY },
      reliability: { raw: reliability, weighted: reliability * MATCHING_WEIGHTS.RELIABILITY },
      rating: { raw: rating, weighted: rating * MATCHING_WEIGHTS.RATING },
      fairness: { raw: fairness, weighted: fairness * MATCHING_WEIGHTS.FAIRNESS },
    },
    technician_stats: {
      completed_jobs: technician.completed_request_count,
      avg_rating: technician.average_rating,
      probation_status: technician.probation_status,
      recent_offer_count_7d: technician.recent_offer_count_7d,
      last_offered_at: technician.last_offered_at,
    },
  };

  return {
    technician,
    distance_km: distanceKm,
    match_score,
    score_band,
    breakdown: {
      skill_fit,
      proximity,
      time_availability,
      reliability,
      rating,
      fairness,
    },
    explanation,
  };
}

/**
 * Deterministic multi-key sort for candidate ranking with fair rotation (Spec v1.1 Section 18.3)
 */
export function sortCandidatesWithFairRotation(
  candidates: ScoredCandidate[],
  urgency: UrgencyLevel = 'NORMAL'
): ScoredCandidate[] {
  return [...candidates].sort((a, b) => {
    // 1. Score band, descending
    if (a.score_band !== b.score_band) {
      return b.score_band - a.score_band;
    }

    // 2. last_offered_at, ascending, NULLS FIRST
    const aLastOffered = a.technician.last_offered_at ? new Date(a.technician.last_offered_at).getTime() : 0;
    const bLastOffered = b.technician.last_offered_at ? new Date(b.technician.last_offered_at).getTime() : 0;
    if (aLastOffered !== bLastOffered) {
      return aLastOffered - bLastOffered;
    }

    // 3. recent_offer_count_7d, ascending
    if (a.technician.recent_offer_count_7d !== b.technician.recent_offer_count_7d) {
      return a.technician.recent_offer_count_7d - b.technician.recent_offer_count_7d;
    }

    // 4. recent_assignment_count_30d, ascending
    if (a.technician.recent_assignment_count_30d !== b.technician.recent_assignment_count_30d) {
      return a.technician.recent_assignment_count_30d - b.technician.recent_assignment_count_30d;
    }

    // 5. probation priority, descending when non-safety-critical
    if (urgency !== 'SAFETY_CRITICAL') {
      const aProb = a.technician.probation_status === 'ACTIVE' ? 1 : 0;
      const bProb = b.technician.probation_status === 'ACTIVE' ? 1 : 0;
      if (aProb !== bProb) {
        return bProb - aProb;
      }
    }

    // 6. technician profile creation time, ascending
    const aCreated = new Date(a.technician.created_at).getTime();
    const bCreated = new Date(b.technician.created_at).getTime();
    if (aCreated !== bCreated) {
      return aCreated - bCreated;
    }

    // 7. technician ID, ascending as final stable tie-breaker
    return a.technician.technician_id.localeCompare(b.technician.technician_id);
  });
}

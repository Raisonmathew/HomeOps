import { ProbationStatus } from './database';

export interface CandidateTechnician {
  technician_id: string;
  profile_id: string;
  telegram_user_id: number;
  full_name: string;
  phone_number?: string | null;
  account_status: string;
  verification_status: string;
  current_latitude: number;
  current_longitude: number;
  effective_radius_km: number;
  location_expires_at: string;
  /** End of the technician's availability session (spec §6.3) */
  available_until?: string;
  active_assignments_count: number;
  average_rating: number;
  completed_request_count: number;
  acceptance_rate: number;
  completion_rate: number;
  post_acceptance_cancellation_rate: number;
  complaint_rate: number;
  probation_status: ProbationStatus;
  last_offered_at?: string | null;
  recent_offer_count_7d: number;
  recent_assignment_count_30d: number;
  created_at: string;
  has_exact_skill: boolean;
  has_category_skill: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  distance_km: number;
}

export interface ScoredCandidate {
  technician: CandidateTechnician;
  distance_km: number;
  match_score: number;
  score_band: number; // Math.floor(score / 5) * 5
  breakdown: {
    skill_fit: number;
    proximity: number;
    time_availability: number;
    reliability: number;
    rating: number;
    fairness: number;
  };
  explanation: Record<string, unknown>;
}

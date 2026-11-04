import { CandidateTechnician, EligibilityResult } from '../types/matching';
import { haversineDistanceKm } from './distance-calculator';
import { BATCH_CONFIG } from '../config/constants';

export function evaluateEligibility(
  technician: CandidateTechnician,
  customerLat: number,
  customerLon: number
): EligibilityResult {
  const reasons: string[] = [];

  // 1. Account & Verification Status
  if (technician.account_status !== 'ACTIVE') {
    reasons.push('Account is not active');
  }
  if (technician.verification_status !== 'APPROVED') {
    reasons.push('Technician profile is not verified/approved');
  }

  // 2. Skill check
  if (!technician.has_exact_skill && !technician.has_category_skill) {
    reasons.push('Required skill is not approved');
  }

  // 3. Location Freshness
  const now = new Date();
  if (new Date(technician.location_expires_at) < now) {
    reasons.push('Current location session has expired');
  }

  // 4. Distance vs Effective Radius
  const distanceKm = haversineDistanceKm(
    technician.current_latitude,
    technician.current_longitude,
    customerLat,
    customerLon
  );

  if (distanceKm > technician.effective_radius_km) {
    reasons.push(`Distance (${distanceKm} km) exceeds work radius (${technician.effective_radius_km} km)`);
  }

  // 5. Active Workload Capacity
  if (technician.active_assignments_count >= BATCH_CONFIG.MAX_ACTIVE_ASSIGNMENTS) {
    reasons.push('Technician has reached maximum concurrent active assignments');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    distance_km: distanceKm,
  };
}

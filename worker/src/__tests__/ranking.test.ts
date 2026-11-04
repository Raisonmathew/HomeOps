import { describe, it, expect } from 'vitest';
import { rankCandidate, sortCandidatesWithFairRotation } from '../matching/ranking';
import { CandidateTechnician, ScoredCandidate } from '../types/matching';

const createTech = (overrides: Partial<CandidateTechnician>): CandidateTechnician => ({
  technician_id: 'tech-default',
  profile_id: 'prof-default',
  telegram_user_id: 111,
  full_name: 'Tech Name',
  account_status: 'ACTIVE',
  verification_status: 'APPROVED',
  current_latitude: 12.9716,
  current_longitude: 77.5946,
  effective_radius_km: 10.0,
  location_expires_at: new Date(Date.now() + 3600000).toISOString(),
  active_assignments_count: 0,
  average_rating: 4.8,
  completed_request_count: 10,
  acceptance_rate: 0.95,
  completion_rate: 0.98,
  post_acceptance_cancellation_rate: 0.02,
  complaint_rate: 0.0,
  probation_status: 'COMPLETED',
  recent_offer_count_7d: 2,
  recent_assignment_count_30d: 5,
  created_at: '2024-01-01T00:00:00Z',
  has_exact_skill: true,
  has_category_skill: true,
  ...overrides,
});

describe('Ranking and Scoring Algorithm', () => {
  it('computes match score bounded between 0 and 100', () => {
    const tech = createTech({});
    const scored = rankCandidate(tech, 2.0); // 2 km out of 10 km radius

    expect(scored.match_score).toBeGreaterThan(70);
    expect(scored.match_score).toBeLessThanOrEqual(100);
    expect(scored.score_band).toBe(Math.floor(scored.match_score / 5) * 5);
  });

  it('gives exact skill higher score than general category skill', () => {
    const techExact = createTech({ has_exact_skill: true, has_category_skill: true });
    const techCat = createTech({ has_exact_skill: false, has_category_skill: true });

    const scoredExact = rankCandidate(techExact, 3.0);
    const scoredCat = rankCandidate(techCat, 3.0);

    expect(scoredExact.match_score).toBeGreaterThan(scoredCat.match_score);
    expect(scoredExact.breakdown.skill_fit).toBe(1.0);
    expect(scoredCat.breakdown.skill_fit).toBe(0.8);
  });

  it('performs deterministic fair rotation within the same 5-point score band', () => {
    // Both technicians will have very close scores in the same score band
    const techA = createTech({
      technician_id: 'tech-A',
      last_offered_at: '2024-03-20T10:00:00Z',
      recent_offer_count_7d: 5,
    });
    const techB = createTech({
      technician_id: 'tech-B',
      last_offered_at: null, // Nulls first (never offered)
      recent_offer_count_7d: 0,
    });

    const scoredA = rankCandidate(techA, 3.0);
    const scoredB = rankCandidate(techB, 3.0);

    const candidates: ScoredCandidate[] = [scoredA, scoredB];
    const sorted = sortCandidatesWithFairRotation(candidates, 'NORMAL');

    // techB should be rotated to index 0 because last_offered_at is null (never offered)
    expect(sorted[0].technician.technician_id).toBe('tech-B');
    expect(sorted[1].technician.technician_id).toBe('tech-A');
  });
});

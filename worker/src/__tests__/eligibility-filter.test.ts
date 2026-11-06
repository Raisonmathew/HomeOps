import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '../matching/eligibility-filter';
import { CandidateTechnician } from '../types/matching';

const baseTechnician: CandidateTechnician = {
  technician_id: 'tech-1',
  profile_id: 'prof-1',
  telegram_user_id: 123456,
  full_name: 'Rajesh K',
  account_status: 'ACTIVE',
  verification_status: 'APPROVED',
  current_latitude: 12.9716,
  current_longitude: 77.5946,
  effective_radius_km: 8.0,
  location_expires_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
  active_assignments_count: 0,
  average_rating: 4.8,
  completed_request_count: 10,
  acceptance_rate: 0.95,
  completion_rate: 0.98,
  post_acceptance_cancellation_rate: 0.02,
  complaint_rate: 0.01,
  probation_status: 'COMPLETED',
  recent_offer_count_7d: 1,
  recent_assignment_count_30d: 5,
  created_at: new Date().toISOString(),
  has_exact_skill: true,
  has_category_skill: true,
};

describe('availability window', () => {
  it('rejects a technician whose session ends before the requested start', async () => {
    const { evaluateEligibility } = await import('../matching/eligibility-filter');
    const base = {
      technician_id: 't', profile_id: 'p', telegram_user_id: 1, full_name: 'T', account_status: 'ACTIVE',
      verification_status: 'APPROVED', current_latitude: 12.97, current_longitude: 77.59, effective_radius_km: 10,
      location_expires_at: new Date(Date.now() + 8 * 3600e3).toISOString(),
      available_until: new Date(Date.now() + 1 * 3600e3).toISOString(),
      active_assignments_count: 0, average_rating: 0, completed_request_count: 0, acceptance_rate: 1, completion_rate: 1,
      post_acceptance_cancellation_rate: 0, complaint_rate: 0, probation_status: 'ACTIVE' as const,
      recent_offer_count_7d: 0, recent_assignment_count_30d: 0, created_at: new Date().toISOString(),
      has_exact_skill: true, has_category_skill: true,
    };
    const inTwoHours = new Date(Date.now() + 2 * 3600e3).toISOString();
    expect(evaluateEligibility(base, 12.97, 77.59, inTwoHours).eligible).toBe(false);
    expect(evaluateEligibility(base, 12.97, 77.59, new Date().toISOString()).eligible).toBe(true);
  });
});

describe('Eligibility Filter', () => {
  it('approves an active, approved technician within radius', () => {
    // 2 km away
    const result = evaluateEligibility(baseTechnician, 12.9800, 77.6000);
    expect(result.eligible).toBe(true);
    expect(result.reasons.length).toBe(0);
  });

  it('rejects a technician outside their effective radius', () => {
    // ~20 km away
    const result = evaluateEligibility(baseTechnician, 12.9698, 77.7500);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('exceeds work radius'))).toBe(true);
  });

  it('rejects a technician whose account is not ACTIVE', () => {
    const tech = { ...baseTechnician, account_status: 'SUSPENDED' };
    const result = evaluateEligibility(tech, 12.9800, 77.6000);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('Account is not active');
  });

  it('rejects a technician whose location session has expired', () => {
    const tech = { ...baseTechnician, location_expires_at: new Date(Date.now() - 1000).toISOString() };
    const result = evaluateEligibility(tech, 12.9800, 77.6000);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('Current location session has expired');
  });

  it('rejects a technician without approved skill', () => {
    const tech = { ...baseTechnician, has_exact_skill: false, has_category_skill: false };
    const result = evaluateEligibility(tech, 12.9800, 77.6000);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('Required skill is not approved');
  });

  it('rejects a technician who exceeded max active assignments', () => {
    const tech = { ...baseTechnician, active_assignments_count: 2 };
    const result = evaluateEligibility(tech, 12.9800, 77.6000);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('Technician has reached maximum concurrent active assignments');
  });
});

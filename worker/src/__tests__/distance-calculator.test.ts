import { describe, it, expect } from 'vitest';
import { haversineDistanceKm } from '../matching/distance-calculator';

describe('Haversine Distance Calculator', () => {
  it('calculates zero distance for identical coordinates', () => {
    const dist = haversineDistanceKm(12.9716, 77.5946, 12.9716, 77.5946);
    expect(dist).toBe(0);
  });

  it('calculates accurate distance between known Bangalore points (MG Road to Whitefield)', () => {
    // MG Road (12.9756, 77.6066) to Whitefield (12.9698, 77.7500) ~ 15.6 km
    const dist = haversineDistanceKm(12.9756, 77.6066, 12.9698, 77.7500);
    expect(dist).toBeGreaterThan(15);
    expect(dist).toBeLessThan(16.5);
  });

  it('calculates short distance accurately (3.8 km range)', () => {
    // 12.9600, 77.7000 to 12.9800, 77.7300 ~ 3.9 km
    const dist = haversineDistanceKm(12.9600, 77.7000, 12.9800, 77.7300);
    expect(dist).toBeCloseTo(3.9, 1);
  });
});

import { describe, it, expect } from 'vitest';
import { canTransitionState } from '../requests/request-state-machine';

describe('Request State Machine Transition Guards', () => {
  it('re-opens the search when a technician drops out before work starts, but not once work is under way', () => {
    for (const from of ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED'] as const) {
      expect(canTransitionState(from, 'SEARCHING', 'TECHNICIAN'), from).toBe(true);
    }
    expect(canTransitionState('IN_PROGRESS', 'SEARCHING', 'TECHNICIAN')).toBe(false);
    expect(canTransitionState('AGREED', 'CANCELLED_BY_CUSTOMER', 'CUSTOMER')).toBe(false); // customer must ask HomeOps
  });

  it('permits every transition the bot job buttons perform (technician-flow job:*)', () => {
    const botTransitions: [string, string][] = [
      ['ASSIGNED', 'CONTACTED'], // I Contacted the Customer
      ['CONTACTED', 'AGREED'], // Scope & Price Agreed
      ['DISCUSSING_SCOPE', 'AGREED'],
      ['AGREED', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'TECHNICIAN_MARKED_COMPLETE'], // Work Complete
      ['IN_PROGRESS', 'UNABLE_TO_COMPLETE'], // Unable to Complete
      ['CONTACTED', 'UNABLE_TO_COMPLETE'],
    ];
    for (const [from, to] of botTransitions) {
      expect(canTransitionState(from as any, to as any, 'TECHNICIAN'), `${from} → ${to}`).toBe(true);
    }
  });

  it('allows Customer to create REQUESTED from DRAFT', () => {
    expect(canTransitionState('DRAFT', 'REQUESTED', 'CUSTOMER')).toBe(true);
  });

  it('allows Customer to cancel from SEARCHING', () => {
    expect(canTransitionState('SEARCHING', 'CANCELLED_BY_CUSTOMER', 'CUSTOMER')).toBe(true);
  });

  it('allows Technician to follow the full lifecycle: CONTACTED → DISCUSSING_SCOPE → AGREED → IN_PROGRESS → TECHNICIAN_MARKED_COMPLETE', () => {
    expect(canTransitionState('ASSIGNED', 'CONTACTED', 'TECHNICIAN')).toBe(true);
    expect(canTransitionState('CONTACTED', 'DISCUSSING_SCOPE', 'TECHNICIAN')).toBe(true);
    expect(canTransitionState('DISCUSSING_SCOPE', 'AGREED', 'TECHNICIAN')).toBe(true);
    expect(canTransitionState('AGREED', 'IN_PROGRESS', 'TECHNICIAN')).toBe(true);
    expect(canTransitionState('IN_PROGRESS', 'TECHNICIAN_MARKED_COMPLETE', 'TECHNICIAN')).toBe(true);
  });

  it('FORBIDS Technician from jumping CONTACTED directly to IN_PROGRESS (must go through AGREED)', () => {
    expect(canTransitionState('CONTACTED', 'IN_PROGRESS', 'TECHNICIAN')).toBe(false);
  });

  it('FORBIDS Technician from directly marking COMPLETED', () => {
    expect(canTransitionState('CUSTOMER_CONFIRMATION_PENDING', 'COMPLETED', 'TECHNICIAN')).toBe(false);
    expect(canTransitionState('IN_PROGRESS', 'COMPLETED', 'TECHNICIAN')).toBe(false);
  });

  it('allows Customer to confirm COMPLETED from CUSTOMER_CONFIRMATION_PENDING', () => {
    expect(canTransitionState('CUSTOMER_CONFIRMATION_PENDING', 'COMPLETED', 'CUSTOMER')).toBe(true);
  });

  it('allows Operator to resolve DISPUTED to COMPLETED or CANCELLED_BY_OPERATOR', () => {
    expect(canTransitionState('DISPUTED', 'COMPLETED', 'OPERATOR')).toBe(true);
    expect(canTransitionState('DISPUTED', 'CANCELLED_BY_OPERATOR', 'OPERATOR')).toBe(true);
  });
});

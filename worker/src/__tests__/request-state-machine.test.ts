import { describe, it, expect } from 'vitest';
import { canTransitionState } from '../requests/request-state-machine';

describe('Request State Machine Transition Guards', () => {
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

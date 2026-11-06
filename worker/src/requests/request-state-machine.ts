import { RequestStatus, UserRole } from '../types/database';

export interface StateTransitionRule {
  allowedFrom: RequestStatus[];
  allowedRoles: UserRole[];
}

export const STATE_TRANSITIONS: Record<RequestStatus, StateTransitionRule> = {
  DRAFT: {
    allowedFrom: [],
    allowedRoles: ['CUSTOMER'],
  },
  REQUESTED: {
    allowedFrom: ['DRAFT'],
    allowedRoles: ['CUSTOMER'],
  },
  SEARCHING: {
    // Back to searching when the technician drops out before work starts (technician cancel,
    // no-contact timeout, or the customer asking for someone else), so the customer still gets help.
    // From NO_TECHNICIAN_FOUND when an eligible technician comes online (retryUnmatchedRequests).
    allowedFrom: ['REQUESTED', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'NO_TECHNICIAN_FOUND'],
    allowedRoles: ['CUSTOMER', 'TECHNICIAN', 'OPERATOR', 'ADMIN'],
  },
  ASSIGNED: {
    allowedFrom: ['SEARCHING'],
    allowedRoles: ['TECHNICIAN', 'OPERATOR', 'ADMIN'],
  },
  CONTACTED: {
    allowedFrom: ['ASSIGNED'],
    allowedRoles: ['TECHNICIAN', 'CUSTOMER', 'OPERATOR'],
  },
  DISCUSSING_SCOPE: {
    allowedFrom: ['CONTACTED'],
    allowedRoles: ['TECHNICIAN', 'CUSTOMER', 'OPERATOR'],
  },
  AGREED: {
    allowedFrom: ['DISCUSSING_SCOPE', 'CONTACTED'],
    allowedRoles: ['TECHNICIAN', 'CUSTOMER', 'OPERATOR'],
  },
  IN_PROGRESS: {
    allowedFrom: ['AGREED'],
    allowedRoles: ['TECHNICIAN', 'OPERATOR'],
  },
  TECHNICIAN_MARKED_COMPLETE: {
    allowedFrom: ['IN_PROGRESS'],
    allowedRoles: ['TECHNICIAN', 'OPERATOR'],
  },
  CUSTOMER_CONFIRMATION_PENDING: {
    allowedFrom: ['TECHNICIAN_MARKED_COMPLETE'],
    allowedRoles: ['TECHNICIAN', 'OPERATOR'],
  },
  COMPLETED: {
    allowedFrom: ['CUSTOMER_CONFIRMATION_PENDING', 'TECHNICIAN_MARKED_COMPLETE', 'DISPUTED'],
    allowedRoles: ['CUSTOMER', 'OPERATOR', 'ADMIN'],
  },
  PARTIALLY_COMPLETED: {
    allowedFrom: ['CUSTOMER_CONFIRMATION_PENDING', 'IN_PROGRESS', 'DISPUTED'],
    allowedRoles: ['CUSTOMER', 'OPERATOR', 'ADMIN'],
  },
  UNABLE_TO_COMPLETE: {
    allowedFrom: ['IN_PROGRESS', 'CONTACTED'],
    allowedRoles: ['TECHNICIAN', 'OPERATOR'],
  },
  DISPUTED: {
    allowedFrom: ['CUSTOMER_CONFIRMATION_PENDING', 'IN_PROGRESS', 'AGREED'],
    allowedRoles: ['CUSTOMER', 'TECHNICIAN', 'OPERATOR', 'ADMIN'],
  },
  EXPIRED: {
    allowedFrom: ['SEARCHING'],
    allowedRoles: ['OPERATOR', 'ADMIN'],
  },
  NO_TECHNICIAN_FOUND: {
    allowedFrom: ['SEARCHING'],
    allowedRoles: ['OPERATOR', 'ADMIN'],
  },
  CANCELLED_BY_CUSTOMER: {
    allowedFrom: ['DRAFT', 'REQUESTED', 'SEARCHING', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE'],
    allowedRoles: ['CUSTOMER', 'ADMIN'],
  },
  CANCELLED_BY_TECHNICIAN: {
    allowedFrom: ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE'],
    allowedRoles: ['TECHNICIAN', 'ADMIN'],
  },
  CANCELLED_BY_OPERATOR: {
    allowedFrom: [
      'DRAFT',
      'REQUESTED',
      'SEARCHING',
      'ASSIGNED',
      'CONTACTED',
      'DISCUSSING_SCOPE',
      'AGREED',
      'IN_PROGRESS',
      'DISPUTED',
      'CUSTOMER_CONFIRMATION_PENDING', // escalated "never confirmed" jobs (sweeps.ts)
    ],
    allowedRoles: ['OPERATOR', 'ADMIN'],
  },
};

export function canTransitionState(
  currentStatus: RequestStatus,
  targetStatus: RequestStatus,
  role: UserRole
): boolean {
  const rule = STATE_TRANSITIONS[targetStatus];
  if (!rule) return false;

  const statusAllowed = rule.allowedFrom.includes(currentStatus);
  const roleAllowed = rule.allowedRoles.includes(role);

  return statusAllowed && roleAllowed;
}

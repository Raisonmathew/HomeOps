export type UserRole = 'CUSTOMER' | 'TECHNICIAN' | 'OPERATOR' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'DELETED';
export type VerificationStatus = 'APPLIED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type ProbationStatus = 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED';
export type UrgencyLevel = 'NORMAL' | 'PRIORITY' | 'SAFETY_CRITICAL';

export type RequestStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'SEARCHING'
  | 'ASSIGNED'
  | 'CONTACTED'
  | 'DISCUSSING_SCOPE'
  | 'AGREED'
  | 'IN_PROGRESS'
  | 'TECHNICIAN_MARKED_COMPLETE'
  | 'CUSTOMER_CONFIRMATION_PENDING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'UNABLE_TO_COMPLETE'
  | 'DISPUTED'
  | 'EXPIRED'
  | 'NO_TECHNICIAN_FOUND'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_TECHNICIAN'
  | 'CANCELLED_BY_OPERATOR';

export interface DashboardMetric {
  searchingRequests: number;
  activeAssignments: number;
  awaitingConfirmation: number;
  disputedRequests: number;
  onlineTechnicians: number;
  noMatchRequests: number;
}

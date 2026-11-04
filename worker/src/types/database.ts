export type UserRole = 'CUSTOMER' | 'TECHNICIAN' | 'OPERATOR' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'DELETED';
export type VerificationStatus = 'APPLIED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type ProbationStatus = 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED';
export type SkillApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type AvailabilityStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'EXPIRED';
export type LocationSource = 'BASE_LOCATION' | 'CURRENT_SHARED_LOCATION' | 'TELEGRAM' | 'MANUAL' | 'OPERATOR_CORRECTED';
export type UrgencyLevel = 'NORMAL' | 'PRIORITY' | 'SAFETY_CRITICAL';
export type PhoneNumberSource = 'SHARED_CONTACT' | 'MANUAL' | 'OPERATOR_VERIFIED';
export type BatchProgressionStatus = 'IDLE' | 'PROCESSING';
export type RelayStatus = 'ACTIVE' | 'CLOSED' | 'BLOCKED';
export type StorageReason = 'VERIFICATION' | 'COMPLAINT' | 'ESSENTIAL_EVIDENCE';
export type ProcessingResult = 'SUCCESS' | 'IGNORED' | 'FAILED';

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

export type OfferStatus =
  | 'SENT'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'LOST_TO_ANOTHER_TECHNICIAN'
  | 'CANCELLED';

export type CustomerAcknowledgementStatus = 'NOT_REVIEWED' | 'ACKNOWLEDGED' | 'DISPUTED';
export type AttachmentType = 'ISSUE_PHOTO' | 'BEFORE_PHOTO' | 'AFTER_PHOTO' | 'COMPLAINT_EVIDENCE' | 'VERIFICATION_DOCUMENT';

export type ComplaintStatus =
  | 'OPEN'
  | 'CUSTOMER_CONTACTED'
  | 'TECHNICIAN_CONTACTED'
  | 'UNDER_REVIEW'
  | 'RESOLVED'
  | 'ACCOUNT_ACTION_TAKEN';

export interface Profile {
  id: string;
  telegram_user_id: number;
  telegram_username?: string | null;
  role: UserRole;
  full_name: string;
  phone_number?: string | null;
  phone_number_source?: PhoneNumberSource | null;
  allow_direct_contact_after_assignment: boolean;
  account_status: AccountStatus;
  accepted_terms_version?: string | null;
  accepted_terms_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TechnicianProfile {
  id: string;
  profile_id: string;
  verification_status: VerificationStatus;
  experience_years: number;
  profile_summary?: string | null;
  base_latitude?: number | null;
  base_longitude?: number | null;
  default_radius_km: number;
  preferred_travel_minutes?: number | null;
  accepts_extended_distance: boolean;
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
  updated_at: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  display_order: number;
}

export interface IssueType {
  id: string;
  service_category_id: string;
  name: string;
  required_skill_code: string;
  urgency_level: UrgencyLevel;
  safety_message?: string | null;
  active: boolean;
}

export interface ServiceRequest {
  id: string;
  request_number: string;
  customer_id: string;
  assigned_technician_id?: string | null;
  service_category_id: string;
  issue_type_id: string;
  description: string;
  service_address_text?: string | null;
  service_latitude: number;
  service_longitude: number;
  preferred_start_time: string;
  preferred_end_time: string;
  urgency: UrgencyLevel;
  status: RequestStatus;
  current_offer_batch: number;
  batch_progression_status: BatchProgressionStatus;
  batch_progression_claimed_at?: string | null;
  operator_review_required: boolean;
  created_at: string;
  search_started_at?: string | null;
  assigned_at?: string | null;
  work_started_at?: string | null;
  completed_at?: string | null;
}

export interface RequestOffer {
  id: string;
  service_request_id: string;
  technician_id: string;
  distance_km: number;
  technician_radius_km: number;
  match_score: number;
  match_explanation: Record<string, unknown>;
  offer_batch: number;
  offer_status: OfferStatus;
  offered_at: string;
  viewed_at?: string | null;
  responded_at?: string | null;
  expires_at: string;
}

export interface AssignmentConversation {
  id: string;
  service_request_id: string;
  customer_id: string;
  technician_id: string;
  relay_status: RelayStatus;
  created_at: string;
  closed_at?: string | null;
}

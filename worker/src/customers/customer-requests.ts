import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceRequest, UrgencyLevel } from '../types/database';
import { logRequestEvent } from '../security/audit-events';

export interface CreateServiceRequestInput {
  customerId: string;
  serviceCategoryId: string;
  issueTypeId: string;
  description: string;
  serviceAddressText?: string;
  /** General area shown in pre-assignment offers (spec §6.6) */
  serviceLocality?: string | null;
  serviceLatitude: number;
  serviceLongitude: number;
  urgency?: UrgencyLevel;
  preferredStartTime?: string;
  preferredEndTime?: string;
  /**
   * true: the caller runs batch 1 right away, so the row is pre-claimed (PROCESSING) to keep the cron out.
   * false: a scheduled slot; the cron starts the search SEARCH.LEAD_TIME_HOURS before it.
   */
  startSearchNow: boolean;
}

const DESCRIPTION_MAX_LENGTH = 1000;

/** Validate inputs per spec §8 Validation Rules. Returns an error message or null. */
function validateServiceRequestInput(input: CreateServiceRequestInput): string | null {
  if (input.serviceLatitude < -90 || input.serviceLatitude > 90) {
    return 'serviceLatitude must be between -90 and 90';
  }
  if (input.serviceLongitude < -180 || input.serviceLongitude > 180) {
    return 'serviceLongitude must be between -180 and 180';
  }
  if (!input.description || input.description.trim().length === 0) {
    return 'description is required';
  }
  if (input.description.length > DESCRIPTION_MAX_LENGTH) {
    return `description must not exceed ${DESCRIPTION_MAX_LENGTH} characters`;
  }
  if (input.preferredStartTime && input.preferredEndTime) {
    if (new Date(input.preferredEndTime) <= new Date(input.preferredStartTime)) {
      return 'preferredEndTime must be later than preferredStartTime';
    }
  }
  return null;
}

export async function createServiceRequest(
  supabase: SupabaseClient,
  input: CreateServiceRequestInput
): Promise<ServiceRequest | null> {
  const validationError = validateServiceRequestInput(input);
  if (validationError) {
    console.error('createServiceRequest validation failed:', validationError);
    return null;
  }

  const now = new Date();
  const startTime = input.preferredStartTime || now.toISOString();
  const endTime = input.preferredEndTime || new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('service_requests')
    .insert({
      customer_id: input.customerId,
      service_category_id: input.serviceCategoryId,
      issue_type_id: input.issueTypeId,
      description: input.description,
      service_address_text: input.serviceAddressText || null,
      service_locality: input.serviceLocality || null,
      service_latitude: input.serviceLatitude,
      service_longitude: input.serviceLongitude,
      preferred_start_time: startTime,
      preferred_end_time: endTime,
      urgency: input.urgency || 'NORMAL',
      status: 'SEARCHING',
      current_offer_batch: 0,
      batch_progression_status: input.startSearchNow ? 'PROCESSING' : 'IDLE',
      batch_progression_claimed_at: input.startSearchNow ? now.toISOString() : null,
      search_started_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('Failed to create service request:', error);
    return null;
  }

  const createdRequest = data as ServiceRequest;

  await logRequestEvent(supabase, {
    serviceRequestId: createdRequest.id,
    eventType: 'REQUEST_CREATED',
    newStatus: 'SEARCHING',
    performedBy: input.customerId,
    notes: 'Customer submitted new service request',
  });

  return createdRequest;
}

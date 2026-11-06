import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { TechnicianNotifications } from './technician-notifications';
import { CustomerNotifications } from './customer-notifications';

/**
 * After a successful assignment (technician accepted, or operator assigned): give the technician
 * the exact location, contact and photos, and introduce the technician to the customer.
 * Exact details are released only here, after assignment (spec §6.6).
 */
export async function notifyAssignment(
  supabase: SupabaseClient,
  sender: MessageSender,
  requestId: string,
  technicianId: string,
  distanceKm: number | null
): Promise<void> {
  const [{ data: r }, { data: t }, { data: photos }] = await Promise.all([
    supabase
      .from('service_requests')
      .select(
        'id, request_number, service_address_text, service_latitude, service_longitude, description, category:service_categories(name), ' +
          'customer:profiles!service_requests_customer_id_fkey(telegram_user_id, full_name, phone_number, telegram_username, allow_direct_contact_after_assignment)'
      )
      .eq('id', requestId)
      .single(),
    supabase
      .from('technician_profiles')
      .select(
        'average_rating, completed_request_count, ' +
          'profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id, full_name, phone_number, telegram_username, allow_direct_contact_after_assignment)'
      )
      .eq('id', technicianId)
      .single(),
    supabase
      .from('attachments')
      .select('telegram_file_id')
      .eq('service_request_id', requestId)
      .eq('attachment_type', 'ISSUE_PHOTO'),
  ]);
  if (!r || !t) return;
  const req = r as any;

  // New start PIN for every assignment (a reassigned technician can't reuse the old one)
  const startPin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
  await supabase.from('service_requests').update({ start_pin: startPin, start_pin_attempts: 0 }).eq('id', requestId);
  const cust = req.customer;
  const tech = (t as any).profile;
  const share = (p: any, value: string | null) => (p.allow_direct_contact_after_assignment ? value : null);

  await TechnicianNotifications.notifyAssignmentWon(sender, tech.telegram_user_id, {
    requestId: req.id,
    requestNumber: req.request_number,
    customerName: cust.full_name,
    customerPhone: share(cust, cust.phone_number),
    customerUsername: share(cust, cust.telegram_username),
    serviceAddress: req.service_address_text,
    serviceLat: req.service_latitude,
    serviceLon: req.service_longitude,
    description: req.description,
  });
  for (const [i, p] of (photos ?? []).entries()) {
    if (p.telegram_file_id) await sender.sendPhoto(tech.telegram_user_id, p.telegram_file_id, `📷 Photo ${i + 1} for ${req.request_number}`);
  }

  await CustomerNotifications.notifyTechnicianMatched(sender, cust.telegram_user_id, {
    requestId: req.id,
    fullName: tech.full_name,
    categoryName: req.category?.name ?? 'Service',
    rating: Number((t as any).average_rating),
    completedJobs: (t as any).completed_request_count,
    phoneNumber: share(tech, tech.phone_number),
    telegramUsername: share(tech, tech.telegram_username),
    distanceKm,
    startPin,
  });
}

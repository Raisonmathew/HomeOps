import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { logRequestEvent } from '../security/audit-events';
import { notifyAssignment } from '../notifications/assignment';
import { cancelServiceRequest } from './cancellation';
import { closeRelay } from './relay';

const OPERATOR_ASSIGNABLE = ['SEARCHING', 'NO_TECHNICIAN_FOUND', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE'];

/** Verifies the dashboard's Supabase access token belongs to an active operator; returns their profile id. */
export async function requireOperator(supabase: SupabaseClient, authHeader: string | null): Promise<string | null> {
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: op } = await supabase
    .from('operator_profiles')
    .select('profile_id, operator_role')
    .eq('supabase_auth_user_id', data.user.id)
    .eq('active', true)
    .maybeSingle();
  if (!op) return null;
  // Spec §10.1: admins must have passed MFA. The token's signature was verified by getUser above.
  if (op.operator_role === 'ADMIN' && jwtClaim(token, 'aal') !== 'aal2') return null;
  return op.profile_id;
}

function jwtClaim(token: string, claim: string): unknown {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))[claim];
  } catch {
    return undefined;
  }
}

/** Operator assigns or reassigns a technician (spec §4.3). Returns an error message, or null on success. */
export async function assignByOperator(
  supabase: SupabaseClient,
  sender: MessageSender,
  operatorProfileId: string,
  requestId: string,
  technicianId: string
): Promise<string | null> {
  const [{ data: tech }, { data: req }] = await Promise.all([
    supabase
      .from('technician_profiles')
      .select('id, profile_id, verification_status, profile:profiles!technician_profiles_profile_id_fkey(account_status)')
      .eq('id', technicianId)
      .maybeSingle(),
    supabase
      .from('service_requests')
      .select(
        'request_number, status, customer_id, assigned_technician_id, ' +
          'technician:technician_profiles!service_requests_assigned_technician_id_fkey(profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id))'
      )
      .eq('id', requestId)
      .maybeSingle(),
  ]);
  const t = tech as any;
  const r = req as any;
  if (!t || t.verification_status !== 'APPROVED' || t.profile?.account_status !== 'ACTIVE') return 'Technician is not approved and active.';
  if (!r) return 'Request not found.';
  if (!OPERATOR_ASSIGNABLE.includes(r.status)) return `Request is ${r.status}; it can't be assigned now.`;
  if (r.assigned_technician_id === technicianId) return 'Request is already assigned to this technician.';
  if (r.customer_id === t.profile_id) return 'A technician cannot be assigned their own request.';

  const { data: updated } = await supabase
    .from('service_requests')
    .update({
      status: 'ASSIGNED',
      assigned_technician_id: technicianId,
      assigned_at: new Date().toISOString(),
      batch_progression_status: 'IDLE',
      batch_progression_claimed_at: null,
      operator_review_required: false,
    })
    .eq('id', requestId)
    .eq('status', r.status) // guard against a concurrent accept/cancel
    .select('id');
  if (!updated?.length) return 'The request changed while assigning. Refresh and try again.';

  // Void outstanding and previously accepted offers, and point the relay at the new technician.
  await supabase
    .from('request_offers')
    .update({ offer_status: 'CANCELLED' })
    .eq('service_request_id', requestId)
    .in('offer_status', ['SENT', 'VIEWED', 'ACCEPTED']);
  await supabase
    .from('assignment_conversations')
    .upsert(
      { service_request_id: requestId, customer_id: r.customer_id, technician_id: t.profile_id, relay_status: 'ACTIVE', closed_at: null },
      { onConflict: 'service_request_id' }
    );
  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: r.assigned_technician_id ? 'REASSIGNED_BY_OPERATOR' : 'ASSIGNED_BY_OPERATOR',
    oldStatus: r.status,
    newStatus: 'ASSIGNED',
    performedBy: operatorProfileId,
    notes: `Operator assigned technician ${technicianId}`,
    // A replaced technician must never be re-offered this request (candidates.ts reads this)
    metadata: r.assigned_technician_id ? { dropped_technician_id: r.assigned_technician_id } : null,
  });

  const previousTechChat = r.technician?.profile?.telegram_user_id;
  if (previousTechChat) {
    await sender.sendMessage({ chatId: previousTechChat, text: `ℹ️ \`${r.request_number}\` was reassigned by the HomeOps team. No further action is needed.` });
  }
  await notifyAssignment(supabase, sender, requestId, technicianId, null);
  return null;
}

/**
 * Operator closes a disputed or never-confirmed job after checking with both parties (spec §6.8:
 * "an operator can resolve or administratively close a disputed request"). Closing as done
 * releases the held ratings and updates the technician's metrics.
 */
export async function resolveByOperator(
  supabase: SupabaseClient,
  sender: MessageSender,
  operatorProfileId: string,
  requestId: string,
  outcome: string
): Promise<string | null> {
  if (outcome === 'CANCELLED_BY_OPERATOR') return cancelByOperator(supabase, sender, operatorProfileId, requestId, 'Closed after review');
  if (outcome !== 'COMPLETED' && outcome !== 'PARTIALLY_COMPLETED') return 'outcome must be COMPLETED, PARTIALLY_COMPLETED or CANCELLED_BY_OPERATOR.';

  const { data: req } = await supabase
    .from('service_requests')
    .select(
      'request_number, status, assigned_technician_id, customer:profiles!service_requests_customer_id_fkey(telegram_user_id), ' +
        'technician:technician_profiles!service_requests_assigned_technician_id_fkey(profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id))'
    )
    .eq('id', requestId)
    .maybeSingle();
  const r = req as any;
  if (!r) return 'Request not found.';
  if (!['DISPUTED', 'CUSTOMER_CONFIRMATION_PENDING'].includes(r.status)) return `Request is ${r.status}; only disputed or unconfirmed jobs can be resolved.`;

  const { data: updated } = await supabase
    .from('service_requests')
    .update({ status: outcome, completed_at: new Date().toISOString(), operator_review_required: false })
    .eq('id', requestId)
    .eq('status', r.status)
    .select('id');
  if (!updated?.length) return 'The request changed while resolving. Refresh and try again.';

  await closeRelay(supabase, requestId);
  await logRequestEvent(supabase, {
    serviceRequestId: requestId,
    eventType: outcome,
    oldStatus: r.status,
    newStatus: outcome,
    performedBy: operatorProfileId,
    notes: 'Resolved by operator',
  });
  if (r.assigned_technician_id) await supabase.rpc('update_technician_metrics', { p_technician_id: r.assigned_technician_id });

  const text = `ℹ️ The HomeOps team closed \`${r.request_number}\` as ${outcome === 'COMPLETED' ? 'completed' : 'partly completed'}.`;
  if (r.customer?.telegram_user_id) await sender.sendMessage({ chatId: r.customer.telegram_user_id, text });
  if (r.technician?.profile?.telegram_user_id) await sender.sendMessage({ chatId: r.technician.profile.telegram_user_id, text });
  return null;
}

/** Operator cancels a request and both parties are told. Returns an error message, or null on success. */
export async function cancelByOperator(
  supabase: SupabaseClient,
  sender: MessageSender,
  operatorProfileId: string,
  requestId: string,
  reason: string
): Promise<string | null> {
  const { data: req } = await supabase
    .from('service_requests')
    .select(
      'request_number, customer:profiles!service_requests_customer_id_fkey(telegram_user_id), ' +
        'technician:technician_profiles!service_requests_assigned_technician_id_fkey(profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id))'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return 'Request not found.';
  const r = req as any;

  const result = await cancelServiceRequest(supabase, requestId, operatorProfileId, 'OPERATOR', reason || 'Cancelled by operator');
  if (!result.success) return `Request is ${result.oldStatus}; it can't be cancelled now.`;

  const text = `ℹ️ \`${r.request_number}\` was cancelled by the HomeOps team.${reason ? ` Reason: ${reason.replace(/[_*`\[]/g, '')}` : ''}`;
  if (r.customer?.telegram_user_id) {
    await sender.sendMessage({ chatId: r.customer.telegram_user_id, text, replyMarkup: KeyboardBuilder.customerMainMenu() });
  }
  if (r.technician?.profile?.telegram_user_id) await sender.sendMessage({ chatId: r.technician.profile.telegram_user_id, text });
  return null;
}

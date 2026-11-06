import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { escapeMd } from '../telegram/format';
import { REPORT_CATEGORIES, SAFETY_CONFIG } from '../config/constants';
import { setTechnicianOffline } from '../technicians/availability';
import { reopenSearch } from '../requests/cancellation';
import { startRematch } from '../matching/search';
import { SEARCH_FIELDS } from '../matching/candidates';

type Category = (typeof REPORT_CATEGORIES)[number]['code'];
export type AccountAction = 'WARN' | 'RESTRICT' | 'SUSPEND' | 'REACTIVATE';

/** Posts to the operator Support group (SUPPORT_CHAT_ID). Falls back to the log if it isn't configured. */
export async function alertOperators(sender: MessageSender, supportChatId: string | undefined, text: string): Promise<void> {
  if (!supportChatId || !(await sender.sendMessage({ chatId: Number(supportChatId), text }))) {
    console.error(`[SAFETY ALERT, no support chat delivered] ${text}`);
  }
}

/**
 * A customer or technician reports the other party (both directions).
 * Harassment/unsafe reports are urgent: operators are alerted immediately, the chat relay is
 * blocked to protect the reporter, and any rating the reported person left on this job is held
 * (no retaliation). Repeat offenders are restricted automatically pending review.
 */
export async function fileSafetyReport(
  supabase: SupabaseClient,
  sender: MessageSender,
  supportChatId: string | undefined,
  report: { requestId: string; requestNumber: string; reporterProfileId: string; reporterName: string; againstProfileId: string; category: Category; description: string }
): Promise<void> {
  const meta = REPORT_CATEGORIES.find((c) => c.code === report.category) ?? REPORT_CATEGORIES[3];
  await supabase.from('complaints').insert({
    service_request_id: report.requestId,
    reported_by: report.reporterProfileId,
    reported_against: report.againstProfileId,
    complaint_type: meta.label.replace(/^\S+\s/, ''),
    category: report.category,
    priority: meta.urgent ? 'URGENT' : 'NORMAL',
    description: report.description,
    status: 'OPEN',
  });
  await supabase.from('service_requests').update({ operator_review_required: true }).eq('id', report.requestId);
  if (!meta.urgent) return;

  await supabase
    .from('assignment_conversations')
    .update({ relay_status: 'BLOCKED', closed_at: new Date().toISOString() })
    .eq('service_request_id', report.requestId);
  await supabase.from('ratings').update({ held: true }).eq('service_request_id', report.requestId).eq('reviewer_id', report.againstProfileId);

  await alertOperators(
    sender,
    supportChatId,
    `🚨 *URGENT ${report.category} report* on \`${report.requestNumber}\`\nFrom: ${escapeMd(report.reporterName)}\n\n${escapeMd(report.description.slice(0, 1500))}\n\nOpen the dashboard → Complaints (URGENT).`
  );

  // Repeat offender: N urgent reports in 90 days → restricted until an operator reviews
  const { count } = await supabase
    .from('complaints')
    .select('id', { count: 'exact', head: true })
    .eq('reported_against', report.againstProfileId)
    .in('category', ['HARASSMENT', 'UNSAFE'])
    .gte('created_at', new Date(Date.now() - 90 * 24 * 3600_000).toISOString());
  if ((count ?? 0) >= SAFETY_CONFIG.HARASSMENT_RESTRICT_COUNT) {
    const { data: target } = await supabase.from('profiles').select('account_status').eq('id', report.againstProfileId).single();
    if (target?.account_status === 'ACTIVE') {
      await applyAccountAction(supabase, sender, supportChatId, null, report.againstProfileId, 'RESTRICT', `${count} harassment or safety reports in 90 days (automatic, pending review)`);
    }
  }
}

/**
 * Warn / restrict / suspend / reactivate an account (operator, or the system when actor is null).
 * Restricting or suspending a technician takes them offline; suspending also releases their open
 * jobs and re-matches those customers. Returns an error message, or null on success.
 */
export async function applyAccountAction(
  supabase: SupabaseClient,
  sender: MessageSender,
  supportChatId: string | undefined,
  actorProfileId: string | null,
  profileId: string,
  action: AccountAction,
  reason: string
): Promise<string | null> {
  const { data: target } = await supabase
    .from('profiles')
    .select('id, role, full_name, telegram_user_id, account_status, warning_count')
    .eq('id', profileId)
    .maybeSingle();
  if (!target) return 'User not found.';
  if (target.role === 'OPERATOR' || target.role === 'ADMIN') return 'Staff accounts are managed from Supabase, not here.';

  const update =
    action === 'WARN'
      ? { warning_count: (target.warning_count ?? 0) + 1 }
      : { account_status: action === 'REACTIVATE' ? 'ACTIVE' : action === 'RESTRICT' ? 'RESTRICTED' : 'SUSPENDED' };
  const { error } = await supabase.from('profiles').update(update).eq('id', profileId);
  if (error) return error.message;
  await supabase.from('account_actions').insert({ target_profile_id: profileId, actor_profile_id: actorProfileId, action, reason });

  const messages: Record<AccountAction, string> = {
    WARN: `⚠️ *Formal warning from HomeOps*\n\nReason: ${escapeMd(reason)}\n\nFurther issues may lead to your account being restricted or suspended.`,
    RESTRICT: `⛔ *Your HomeOps account has been restricted.*\n\nReason: ${escapeMd(reason)}\n\nYou can't book or take new jobs while our team reviews this. Contact Support from the menu if you think this is a mistake.`,
    SUSPEND: `🚫 *Your HomeOps account has been suspended.*\n\nReason: ${escapeMd(reason)}`,
    REACTIVATE: `✅ Your HomeOps account is active again.`,
  };
  await sender.sendMessage({ chatId: target.telegram_user_id, text: messages[action] });

  if (action === 'RESTRICT' || action === 'SUSPEND') {
    const { data: tech } = await supabase.from('technician_profiles').select('id').eq('profile_id', profileId).maybeSingle();
    if (tech) {
      await setTechnicianOffline(supabase, tech.id);
      if (action === 'SUSPEND') await releaseActiveJobs(supabase, sender, tech.id, supportChatId);
    }
  }
  if (!actorProfileId) {
    await alertOperators(sender, supportChatId, `🤖 Automatic ${action} of ${escapeMd(target.full_name)} (${target.role}): ${escapeMd(reason)}`);
  }
  return null;
}

/**
 * A suspended technician's open jobs must not strand customers: jobs not yet started are
 * re-matched; jobs already in progress go to operators, and the customer is told.
 */
export async function releaseActiveJobs(supabase: SupabaseClient, sender: MessageSender, technicianId: string, supportChatId?: string): Promise<void> {
  const { data } = await supabase
    .from('service_requests')
    .select(`${SEARCH_FIELDS}, customer:profiles!service_requests_customer_id_fkey(telegram_user_id)`)
    .eq('assigned_technician_id', technicianId)
    .in('status', ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS']);

  for (const job of (data ?? []) as any[]) {
    const customerChat = job.customer?.telegram_user_id;
    if (job.status === 'IN_PROGRESS') {
      await supabase.from('service_requests').update({ operator_review_required: true }).eq('id', job.id);
      await supabase.from('assignment_conversations').update({ relay_status: 'BLOCKED', closed_at: new Date().toISOString() }).eq('service_request_id', job.id);
      if (customerChat) {
        await sender.sendMessage({
          chatId: customerChat,
          text: `⚠️ Your technician for \`${job.request_number}\` is no longer working with HomeOps. Our team will contact you shortly. If you feel unsafe, call ${'112'}.`,
          replyMarkup: KeyboardBuilder.customerMainMenu(),
        });
      }
      await alertOperators(sender, supportChatId, `⚠️ Suspended technician had an in-progress job \`${job.request_number}\`. Contact the customer.`);
      continue;
    }
    const rematch = await reopenSearch(supabase, job.id, null, 'TECHNICIAN_SUSPENDED', 'Technician account suspended');
    if (rematch) await startRematch(supabase, sender, job, rematch, customerChat, 'Your technician is no longer available.');
  }
}

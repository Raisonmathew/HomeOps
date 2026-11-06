import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { SLA_CONFIG } from '../config/constants';
import { logRequestEvent } from '../security/audit-events';
import { raiseFlag } from '../trust/flags';
import { reopenSearch } from './cancellation';
import { startRematch } from '../matching/search';
import { SEARCH_FIELDS } from '../matching/candidates';
import { releaseActiveJobs } from '../trust/safety';

const PARTIES =
  'customer:profiles!service_requests_customer_id_fkey(telegram_user_id), ' +
  'technician:technician_profiles!service_requests_assigned_technician_id_fkey(id, profile_id, profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id))';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * Time-based protections, run by the every-minute cron. Each step records a marker event,
 * so a job is nudged/reminded/escalated at most once.
 *  1. No contact: nudge the technician, then release the job and search again.
 *  2. Unconfirmed completion: remind the customer, then send to operator review (never auto-complete).
 *  3. Stuck in progress: flag for operators.
 */
export async function runJobSweeps(supabase: SupabaseClient, sender: MessageSender, supportChatId?: string): Promise<void> {
  await noContactSweep(supabase, sender);
  await unconfirmedSweep(supabase, sender);
  await staleJobSweep(supabase);
  await suspendedTechnicianSweep(supabase, sender, supportChatId);
  await verificationNotifySweep(supabase, sender);
}

/** Messages technicians when an operator changes their application status on the dashboard. */
async function verificationNotifySweep(supabase: SupabaseClient, sender: MessageSender): Promise<void> {
  const { data } = await supabase
    .from('technician_profiles')
    .select('id, verification_status, verification_notified_status, profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id)');
  const messages: Record<string, { text: string; online?: boolean }> = {
    UNDER_REVIEW: { text: '🔍 *Your technician application is being reviewed* by the HomeOps team.' },
    APPROVED: {
      text: '🎉 *You are approved as a HomeOps technician!*\n\nTap *🟢 Go Online* whenever you are ready to receive nearby jobs.',
      online: true,
    },
    REJECTED: { text: "Your technician application wasn't approved this time. Contact 🆘 Support from the menu to find out why." },
    SUSPENDED: { text: '⛔ Your technician profile has been suspended. You will not receive new jobs. Contact 🆘 Support for details.' },
  };
  for (const t of (data ?? []) as any[]) {
    if (t.verification_status === t.verification_notified_status) continue;
    const msg = messages[t.verification_status];
    const chatId = t.profile?.telegram_user_id;
    if (msg && chatId) {
      await sender.sendMessage({ chatId, text: msg.text, replyMarkup: msg.online ? KeyboardBuilder.technicianMainMenu(false) : undefined });
    }
    await supabase.from('technician_profiles').update({ verification_notified_status: t.verification_status }).eq('id', t.id);
  }
}

/**
 * Safety net: a technician suspended any other way (e.g. directly in the database) must not keep
 * open jobs. applyAccountAction already releases them; this catches the rest within a minute.
 */
async function suspendedTechnicianSweep(supabase: SupabaseClient, sender: MessageSender, supportChatId?: string): Promise<void> {
  const { data } = await supabase
    .from('service_requests')
    .select(
      'assigned_technician_id, technician:technician_profiles!service_requests_assigned_technician_id_fkey!inner(profile:profiles!technician_profiles_profile_id_fkey!inner(account_status))'
    )
    .in('status', ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED'])
    .eq('technician.profile.account_status', 'SUSPENDED');
  const techIds = [...new Set((data ?? []).map((r: any) => r.assigned_technician_id as string))];
  for (const id of techIds) await releaseActiveJobs(supabase, sender, id, supportChatId);
}

async function markers(supabase: SupabaseClient, ids: string[], eventType: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await supabase.from('request_events').select('service_request_id').eq('event_type', eventType).in('service_request_id', ids);
  return new Set((data ?? []).map((e) => e.service_request_id as string));
}

async function noContactSweep(supabase: SupabaseClient, sender: MessageSender): Promise<void> {
  const { data } = await supabase
    .from('service_requests')
    .select(`${SEARCH_FIELDS}, assigned_at, ${PARTIES}`)
    .eq('status', 'ASSIGNED')
    .lt('assigned_at', minutesAgo(SLA_CONFIG.NO_CONTACT_NUDGE_MINUTES));
  const jobs = (data ?? []) as any[];
  const nudged = await markers(supabase, jobs.map((j) => j.id), 'NO_CONTACT_NUDGE');

  for (const job of jobs) {
    const techChat = job.technician?.profile?.telegram_user_id;
    const ageMin = (Date.now() - new Date(job.assigned_at).getTime()) / 60_000;

    if (ageMin >= SLA_CONFIG.NO_CONTACT_REASSIGN_MINUTES) {
      const rematch = await reopenSearch(supabase, job.id, null, 'NO_CONTACT_REASSIGNED', 'Technician did not contact the customer in time', ['ASSIGNED']);
      if (!rematch) continue;
      if (job.technician) {
        await raiseFlag(supabase, {
          requestId: job.id,
          againstProfileId: job.technician.profile_id,
          type: 'No contact after assignment',
          details: `No contact ${Math.round(ageMin)} min after accepting; job was released automatically.`,
        });
        await supabase.rpc('update_technician_metrics', { p_technician_id: job.technician.id });
      }
      if (techChat) {
        await sender.sendMessage({ chatId: techChat, text: `⌛ \`${job.request_number}\` was released because the customer wasn't contacted in time.` });
      }
      await startRematch(supabase, sender, job, rematch, job.customer?.telegram_user_id, "Your technician didn't get in touch.");
    } else if (!nudged.has(job.id) && techChat) {
      await sender.sendMessage({
        chatId: techChat,
        text: `⏰ Please contact the customer for \`${job.request_number}\` now. If you can't take it, cancel so they can get someone else. Jobs without contact are released automatically.`,
        replyMarkup: KeyboardBuilder.technicianJobStatusButtons(job.id, 'ASSIGNED'),
      });
      await logRequestEvent(supabase, { serviceRequestId: job.id, eventType: 'NO_CONTACT_NUDGE', notes: 'Technician reminded to contact customer' });
    }
  }
}

async function unconfirmedSweep(supabase: SupabaseClient, sender: MessageSender): Promise<void> {
  const { data } = await supabase
    .from('service_requests')
    .select(`id, request_number, ${PARTIES}`)
    .eq('status', 'CUSTOMER_CONFIRMATION_PENDING');
  const jobs = (data ?? []) as any[];
  if (!jobs.length) return;
  const ids = jobs.map((j) => j.id);

  const { data: completions } = await supabase
    .from('request_events')
    .select('service_request_id, created_at')
    .eq('event_type', 'TECHNICIAN_MARKED_COMPLETE')
    .in('service_request_id', ids);
  const markedAt = new Map((completions ?? []).map((e) => [e.service_request_id as string, new Date(e.created_at).getTime()]));
  const [reminded, escalated] = await Promise.all([markers(supabase, ids, 'CONFIRMATION_REMINDER'), markers(supabase, ids, 'CONFIRMATION_ESCALATED')]);

  for (const job of jobs) {
    const at = markedAt.get(job.id);
    if (!at) continue;
    const ageH = (Date.now() - at) / 3600_000;

    if (ageH >= SLA_CONFIG.CONFIRM_ESCALATE_HOURS && !escalated.has(job.id)) {
      if (job.technician) {
        await raiseFlag(supabase, {
          requestId: job.id,
          againstProfileId: job.technician.profile_id,
          type: 'Completion never confirmed',
          details: `Customer hasn't confirmed ${Math.round(ageH)} h after the technician marked it complete. Check with the customer before closing.`,
          needsReview: true,
        });
      }
      await logRequestEvent(supabase, { serviceRequestId: job.id, eventType: 'CONFIRMATION_ESCALATED', notes: 'Sent to operator review' });
    } else if (ageH >= SLA_CONFIG.CONFIRM_REMIND_HOURS && !reminded.has(job.id) && job.customer?.telegram_user_id) {
      await sender.sendMessage({
        chatId: job.customer.telegram_user_id,
        text: `⏰ *Please confirm \`${job.request_number}\`.* The technician marked it complete. Was the work done?`,
        replyMarkup: KeyboardBuilder.customerConfirmCompletion(job.id),
      });
      await logRequestEvent(supabase, { serviceRequestId: job.id, eventType: 'CONFIRMATION_REMINDER', notes: 'Customer reminded to confirm' });
    }
  }
}

async function staleJobSweep(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase
    .from('service_requests')
    .select(`id, work_started_at, ${PARTIES}`)
    .eq('status', 'IN_PROGRESS')
    .lt('work_started_at', minutesAgo(SLA_CONFIG.STALE_JOB_HOURS * 60));
  for (const job of (data ?? []) as any[]) {
    if (!job.technician) continue;
    // raiseFlag de-duplicates per request + type, so this fires once per job
    await raiseFlag(supabase, {
      requestId: job.id,
      againstProfileId: job.technician.profile_id,
      type: 'Job stuck in progress',
      details: `In progress for over ${SLA_CONFIG.STALE_JOB_HOURS} h without being marked complete or unable.`,
      needsReview: true,
    });
  }
}

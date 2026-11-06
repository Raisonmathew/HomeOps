import { BotContext, reply, setStep, clearStep, cb, inStep } from './context';
import { KeyboardBuilder } from './keyboard-builder';
import { escapeMd, formatDateTime, formatWindow } from './format';
import { REVIEW_TAGS, SUPPORT_TEXT, TERMS_TEXT } from '../config/constants';
import { logRequestEvent } from '../security/audit-events';
import { submitComplaint } from '../trust/complaints';
import { raiseFlag } from '../trust/flags';
import { fileSafetyReport, alertOperators } from '../trust/safety';
import { REPORT_CATEGORIES, EMERGENCY_NUMBER } from '../config/constants';
import { reopenSearch, REOPENABLE_STATUSES } from '../requests/cancellation';
import { startRematch } from '../matching/search';
import { SEARCH_FIELDS } from '../matching/candidates';
import { InlineKeyboardMarkup } from '../types/telegram';

const PAYMENT_LABELS: Record<string, string> = {
  NOT_APPLICABLE: 'Not declared',
  DIRECT_PAYMENT_CONFIRMED_BY_CUSTOMER: 'Paid directly (confirmed by customer)',
  DIRECT_PAYMENT_CONFIRMED_BY_TECHNICIAN: 'Paid directly (confirmed by technician)',
  PAYMENT_DISPUTE_REPORTED: 'Payment problem reported',
};

const EVENT_LABELS: Record<string, string> = {
  REQUEST_CREATED: 'Request created',
  BATCH_ADVANCED: 'Offers sent to nearby technicians',
  ASSIGNED: 'Technician assigned',
  ASSIGNED_BY_OPERATOR: 'Technician assigned by HomeOps',
  REASSIGNED_BY_OPERATOR: 'Technician reassigned by HomeOps',
  CUSTOMER_REQUESTED_ANOTHER_TECHNICIAN: 'Customer asked for another technician',
  CONTACTED: 'Technician contacted the customer',
  AGREED: 'Scope & price agreed',
  IN_PROGRESS: 'Work started',
  TECHNICIAN_MARKED_COMPLETE: 'Technician marked work complete',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partly completed',
  DISPUTED: 'Problem reported',
  UNABLE_TO_COMPLETE: 'Technician unable to complete',
  SEARCH_EXHAUSTED: 'No technician found',
  PAYMENT_DECLARED: 'Payment declared',
  CANCELLED_BY_CUSTOMER: 'Cancelled by customer',
  CANCELLED_BY_OPERATOR: 'Cancelled by HomeOps',
};

// Customers review after confirming (or disputing) the job; technicians as soon as they mark it complete,
// so a customer who never confirms doesn't block the technician's review.
const CUSTOMER_RATABLE = ['COMPLETED', 'PARTIALLY_COMPLETED', 'DISPUTED'];
const TECHNICIAN_RATABLE = ['CUSTOMER_CONFIRMATION_PENDING', ...CUSTOMER_RATABLE];
const canRate = (asCustomer: boolean, status: string) => (asCustomer ? CUSTOMER_RATABLE : TECHNICIAN_RATABLE).includes(status);
/** Only jobs that ended recently are worth reminding about */
const REMINDER_WINDOW_MS = 30 * 24 * 3600_000;
const PAYABLE = ['CUSTOMER_CONFIRMATION_PENDING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'DISPUTED'];

/** Flows available to both customers and technicians. Returns true if handled. */
export async function handleShared(ctx: BotContext): Promise<boolean> {
  const { u, supabase, profile } = ctx;

  // ---------------------------------------------------------------- support & terms (spec §9.1)
  if (u.callbackData === 'cmd_terms') {
    await reply(ctx, TERMS_TEXT, KeyboardBuilder.customerMainMenu());
    return true;
  }
  if (u.callbackData === 'cmd_support') {
    await reply(ctx, SUPPORT_TEXT, {
      inline_keyboard: [[{ text: '✉️ Message our team', callback_data: 'support_msg' }], [{ text: '⬅️ Menu', callback_data: 'cmd_customer_portal' }]],
    });
    return true;
  }
  if (u.callbackData === 'support_msg') {
    if (!ctx.config.supportChatId) {
      await reply(ctx, 'Messaging support from the bot is not set up yet. Please try again later.');
      return true;
    }
    await setStep(ctx, 'SUPPORT_MESSAGE');
    await reply(ctx, '✉️ Type your message for the HomeOps team. Include your request number if it is about a job.');
    return true;
  }
  if (inStep(ctx, 'SUPPORT_MESSAGE') && u.text) {
    await clearStep(ctx);
    const handle = profile.telegram_username ? `@${escapeMd(profile.telegram_username)}` : 'no username';
    const delivered = await ctx.sender.sendMessage({
      chatId: Number(ctx.config.supportChatId),
      text: `🆘 *Support message*\nFrom: ${escapeMd(profile.full_name)} (${handle}) · ${profile.role} · TG ${u.userId}\n\n${escapeMd(u.text.slice(0, 3000))}`,
    });
    await reply(
      ctx,
      delivered ? '📨 Sent. Our team will get back to you.' : '⚠️ Could not deliver your message. Please try again shortly.',
      KeyboardBuilder.customerMainMenu()
    );
    return true;
  }

  // ---------------------------------------------------------------- contact privacy (both roles)
  // Direct contact (phone / @username) is optional; the bot relay always works as the fallback (spec §18.2).
  if (u.callbackData === 'cmd_privacy' || u.callbackData === 'privacy_toggle' || u.callbackData === 'privacy_rmphone') {
    let share = profile.allow_direct_contact_after_assignment;
    let phone = profile.phone_number;
    if (u.callbackData === 'privacy_toggle') {
      share = !share;
      await supabase.from('profiles').update({ allow_direct_contact_after_assignment: share }).eq('id', profile.id);
    }
    if (u.callbackData === 'privacy_rmphone') {
      phone = null;
      await supabase.from('profiles').update({ phone_number: null, phone_number_source: null }).eq('id', profile.id);
    }
    const other = profile.role === 'TECHNICIAN' ? 'customers you are assigned to' : 'your assigned technician';
    await reply(
      ctx,
      `🔒 *Contact privacy*\n\n` +
        `Direct contact: *${share ? 'ON' : 'OFF'}*\n` +
        (share
          ? `Your ${phone ? 'phone number and ' : ''}Telegram username are shown to ${other}, so they can call or chat with you directly.\n`
          : `Your phone number and Telegram username are hidden. ${other[0].toUpperCase()}${other.slice(1)} can only message you through this bot chat.\n`) +
        `\n📱 Phone on file: ${phone ? escapeMd(phone) : 'none'}\n\n_Messages through the bot chat always work, whatever you choose._`,
      {
        inline_keyboard: [
          [{ text: share ? '🙈 Hide my contact details' : '👁 Share my contact details', callback_data: 'privacy_toggle' }],
          ...(phone ? [[{ text: '🗑 Remove my phone number', callback_data: 'privacy_rmphone' }]] : []),
          [{ text: '⬅️ Menu', callback_data: profile.role === 'TECHNICIAN' ? 'cmd_tech_portal' : 'cmd_customer_portal' }],
        ],
      }
    );
    return true;
  }

  // ---------------------------------------------------------------- request tracking (both parties)
  const viewId = cb(ctx, 'req_view:');
  if (viewId) {
    const p = await getParticipation(ctx, viewId);
    if (!p) {
      await reply(ctx, 'Request not found.');
      return true;
    }
    const [{ data: events }, { data: estimate }, { data: myRating }] = await Promise.all([
      supabase.from('request_events').select('event_type, new_status, created_at').eq('service_request_id', viewId).order('created_at', { ascending: true }),
      supabase
        .from('estimate_records')
        .select('estimated_total, customer_acknowledgement_status')
        .eq('service_request_id', viewId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('ratings').select('score').eq('service_request_id', viewId).eq('reviewer_id', profile.id).maybeSingle(),
    ]);
    const r = p.req;

    const timeline = (events ?? [])
      .map((e) => {
        const label =
          e.event_type === 'CANCELLED_BY_TECHNICIAN'
            ? e.new_status === 'SEARCHING'
              ? 'Technician cancelled, searching again'
              : 'Cancelled by technician'
            : EVENT_LABELS[e.event_type];
        return label ? `• ${formatDateTime(e.created_at)}: ${label}` : null;
      })
      .filter((line, i, all) => line && !(line.endsWith(EVENT_LABELS.BATCH_ADVANCED) && all[i - 1]?.endsWith(EVENT_LABELS.BATCH_ADVANCED)));

    const otherLine = p.asCustomer
      ? r.technician?.profile?.full_name
        ? `👷 Technician: ${escapeMd(r.technician.profile.full_name)}\n`
        : ''
      : `👤 Customer: ${escapeMd(r.customer?.full_name ?? '')}\n`;

    const buttons: InlineKeyboardMarkup['inline_keyboard'] = [];
    if (p.asCustomer && r.status === 'ASSIGNED') buttons.push([{ text: '🔁 Request another technician', callback_data: `req_reassign:${r.id}` }]);
    if (p.asCustomer && ['ASSIGNED', 'CONTACTED'].includes(r.status)) {
      buttons.push([{ text: "📵 I haven't heard from them", callback_data: `req_nocontact:${r.id}` }]);
    }
    if (p.asCustomer && ['UNABLE_TO_COMPLETE', 'AGREED', 'IN_PROGRESS', 'CUSTOMER_CONFIRMATION_PENDING', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(r.status)) {
      buttons.push([{ text: '⚠️ Report a problem', callback_data: `prob:${r.id}` }]);
    }
    if (p.asCustomer && ['SEARCHING', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE'].includes(r.status)) {
      buttons.push([{ text: '❌ Cancel request', callback_data: `req_cancel:${r.id}` }]);
    }
    if (canRate(p.asCustomer, r.status) && !myRating) buttons.push(...KeyboardBuilder.ratingButtons(r.id).inline_keyboard);
    // Safety tools for both sides: SOS while the job is live, reporting whenever there's another party
    if (['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS', 'CUSTOMER_CONFIRMATION_PENDING'].includes(r.status)) {
      buttons.push([{ text: '🚨 Safety', callback_data: `safety:${r.id}` }]);
    }
    if (p.other.profileId) buttons.push([{ text: `🚩 Report the ${p.asCustomer ? 'technician' : 'customer'}`, callback_data: `rep:${r.id}` }]);
    buttons.push([{ text: '⬅️ Menu', callback_data: p.asCustomer ? 'cmd_customer_portal' : 'cmd_tech_portal' }]);

    await reply(
      ctx,
      `🔎 *${r.request_number}* · \`${r.status}\`\n` +
        `🛠 ${escapeMd(r.category?.name ?? '')} - ${escapeMd(r.issue?.name ?? '')}\n` +
        `🕐 ${formatWindow(r.preferred_start_time, r.preferred_end_time)}\n` +
        otherLine +
        // Only the customer ever sees the start code
        (p.asCustomer && r.start_pin && ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED'].includes(r.status)
          ? `🔑 Start code: *${r.start_pin}* (give it to the technician when they arrive)\n`
          : '') +
        (estimate ? `💰 Estimate: ₹${Number(estimate.estimated_total)} (\`${estimate.customer_acknowledgement_status}\`)\n` : '') +
        `💵 Payment: ${PAYMENT_LABELS[r.payment_declaration] ?? r.payment_declaration}\n` +
        (myRating ? `⭐ You rated: ${myRating.score}/5\n` : '') +
        `\n*Timeline*\n${timeline.join('\n') || '• No updates yet'}`,
      { inline_keyboard: buttons }
    );
    return true;
  }

  // ---------------------------------------------------------------- payment declaration (spec §6.7)
  const pay = cb(ctx, 'pay:');
  if (pay) {
    const [kind, requestId] = pay.split(':');
    const p = await getParticipation(ctx, requestId);
    if (!p || !PAYABLE.includes(p.req.status)) {
      await reply(ctx, 'Payment can be declared once the work is marked complete.');
      return true;
    }
    const role = p.asCustomer ? 'customer' : 'technician';

    if (kind === 'PAID') {
      // HomeOps records the declaration; it never verifies payment. A reported dispute is never overwritten,
      // and a technician's confirmation doesn't override the customer's.
      const q = supabase
        .from('service_requests')
        .update({ payment_declaration: p.asCustomer ? 'DIRECT_PAYMENT_CONFIRMED_BY_CUSTOMER' : 'DIRECT_PAYMENT_CONFIRMED_BY_TECHNICIAN' })
        .eq('id', requestId);
      await (p.asCustomer ? q.neq('payment_declaration', 'PAYMENT_DISPUTE_REPORTED') : q.eq('payment_declaration', 'NOT_APPLICABLE'));
      await reply(ctx, '✅ Noted, thank you.');
    } else if (kind === 'DISPUTE') {
      await supabase.from('service_requests').update({ payment_declaration: 'PAYMENT_DISPUTE_REPORTED', operator_review_required: true }).eq('id', requestId);
      if (p.other.profileId) {
        await submitComplaint(supabase, {
          serviceRequestId: requestId,
          reportedByProfileId: profile.id,
          reportedAgainstProfileId: p.other.profileId,
          complaintType: 'Payment dispute',
          description: `Payment problem reported by the ${role} in the bot.`,
        });
      }
      await reply(ctx, '📨 Our team has been notified and will contact you.');
      if (p.other.chat) {
        await ctx.sender.sendMessage({
          chatId: p.other.chat,
          text: `⚠️ The ${role} reported a payment problem on \`${p.req.request_number}\`. The HomeOps team will review it.`,
        });
      }
    } else {
      await reply(ctx, `⏳ Okay. Please settle payment directly with the ${p.asCustomer ? 'technician' : 'customer'}.`);
    }
    await logRequestEvent(supabase, {
      serviceRequestId: requestId,
      eventType: 'PAYMENT_DECLARED',
      performedBy: profile.id,
      notes: `${role}: ${kind}`,
    });

    if (p.asCustomer && canRate(true, p.req.status)) await promptRating(ctx, requestId, p.other.name, true);
    return true;
  }

  // ---------------------------------------------------------------- two-way ratings (spec §6.9)
  const rate = cb(ctx, 'rate:');
  if (rate) {
    const [scoreStr, requestId] = rate.split(':');
    const score = Math.max(1, Math.min(5, parseInt(scoreStr, 10) || 0));
    const p = await getParticipation(ctx, requestId);
    if (!p || !p.other.profileId || !canRate(p.asCustomer, p.req.status)) {
      await reply(ctx, p?.asCustomer ? 'You can leave a rating once you confirm the job is done.' : 'You can leave a rating once the work is marked complete.');
      return true;
    }
    const { error } = await supabase.from('ratings').insert({
      service_request_id: requestId,
      reviewer_id: profile.id,
      reviewed_profile_id: p.other.profileId,
      score,
    });
    if (error) {
      await reply(ctx, error.code === '23505' ? 'You have already rated this job.' : 'Could not save your rating. Please try again.');
      return true;
    }
    if (p.asCustomer && p.req.technician?.id) {
      await supabase.rpc('update_technician_metrics', { p_technician_id: p.req.technician.id });
      await checkCollusion(ctx, requestId, p.req.technician.id, p.req.technician.profile_id);
    }
    await reply(
      ctx,
      `${'⭐'.repeat(score)} Thanks! ${score >= 4 ? 'What did you like?' : 'What could be better?'} (optional)`,
      tagsKeyboard(requestId, p.asCustomer, score, [])
    );
    return true;
  }

  const tag = cb(ctx, 'rtag:');
  if (tag) {
    const [idxStr, requestId] = tag.split(':');
    const { data: rating } = await supabase
      .from('ratings')
      .select('id, score, tags')
      .eq('service_request_id', requestId)
      .eq('reviewer_id', profile.id)
      .maybeSingle();
    const p = rating ? await getParticipation(ctx, requestId) : null;
    if (!rating || !p) return true;
    const label = tagList(p.asCustomer, rating.score)[parseInt(idxStr, 10)];
    if (!label) return true;
    const current: string[] = rating.tags ?? [];
    const tags = current.includes(label) ? current.filter((t) => t !== label) : [...current, label];
    await supabase.from('ratings').update({ tags }).eq('id', rating.id);
    if (u.messageId) await ctx.sender.editReplyMarkup(u.chatId, u.messageId, tagsKeyboard(requestId, p.asCustomer, rating.score, tags));
    return true;
  }

  const commentFor = cb(ctx, 'rcomment:');
  if (commentFor) {
    await setStep(ctx, 'RATE_COMMENT', { requestId: commentFor });
    await reply(ctx, '📝 Type your comment (up to 500 characters).');
    return true;
  }
  if (inStep(ctx, 'RATE_COMMENT') && u.text) {
    const requestId = ctx.session!.data.requestId as string;
    await supabase
      .from('ratings')
      .update({ comment: u.text.trim().slice(0, 500) })
      .eq('service_request_id', requestId)
      .eq('reviewer_id', profile.id);
    await clearStep(ctx);
    await thankForFeedback(ctx);
    return true;
  }
  if (cb(ctx, 'rdone:') !== null) {
    await thankForFeedback(ctx);
    return true;
  }

  // ---------------------------------------------------------------- report the other party (both directions)
  const reportId = cb(ctx, 'rep:');
  if (reportId) {
    const p = await getParticipation(ctx, reportId);
    if (!p?.other.profileId) {
      await reply(ctx, 'There is no one to report on this request yet.');
      return true;
    }
    await reply(ctx, `🚩 *Report ${escapeMd(p.other.name ?? (p.asCustomer ? 'the technician' : 'the customer'))}*\n\nWhat happened?`, {
      inline_keyboard: [
        ...REPORT_CATEGORIES.map((c, i) => [{ text: c.label, callback_data: `repc:${i}:${reportId}` }]),
        [{ text: '⬅️ Back', callback_data: `req_view:${reportId}` }],
      ],
    });
    return true;
  }

  const reportCat = cb(ctx, 'repc:');
  if (reportCat) {
    const [idx, requestId] = reportCat.split(':');
    const category = REPORT_CATEGORIES[parseInt(idx, 10)] ?? REPORT_CATEGORIES[3];
    await setStep(ctx, 'REPORT_TEXT', { requestId, category: category.code });
    await reply(
      ctx,
      `📝 *Describe what happened* in a message. Include anything that helps us act (what was said or done, when).` +
        (category.urgent ? `\n\n🚨 If you are in danger right now, leave the situation and call *${EMERGENCY_NUMBER}*.` : '')
    );
    return true;
  }

  if (inStep(ctx, 'REPORT_TEXT') && u.text) {
    const { requestId, category } = ctx.session!.data as { requestId: string; category: (typeof REPORT_CATEGORIES)[number]['code'] };
    await clearStep(ctx);
    const p = await getParticipation(ctx, requestId);
    if (!p?.other.profileId) return true;
    const urgent = REPORT_CATEGORIES.find((c) => c.code === category)?.urgent ?? false;

    await fileSafetyReport(supabase, ctx.sender, ctx.config.supportChatId, {
      requestId,
      requestNumber: p.req.request_number,
      reporterProfileId: profile.id,
      reporterName: `${profile.full_name} (${p.asCustomer ? 'customer' : 'technician'})`,
      againstProfileId: p.other.profileId,
      category,
      description: u.text.trim().slice(0, 3000),
    });

    // A customer reporting harassment before work starts gets a different technician straight away.
    let rematched = false;
    if (urgent && p.asCustomer && REOPENABLE_STATUSES.includes(p.req.status)) {
      const job = (await supabase.from('service_requests').select(SEARCH_FIELDS).eq('id', requestId).single()).data;
      const rematch = await reopenSearch(supabase, requestId, profile.id, 'CUSTOMER_REQUESTED_ANOTHER_TECHNICIAN', 'Customer reported harassment/safety issue');
      if (rematch && job) {
        rematched = true;
        if (p.other.chat) await ctx.sender.sendMessage({ chatId: p.other.chat, text: `ℹ️ You have been removed from \`${p.req.request_number}\`. The HomeOps team will contact you.` });
        await startRematch(supabase, ctx.sender, job, rematch, u.chatId, 'You will not be matched with that technician again.');
      }
    }

    await reply(
      ctx,
      urgent
        ? `🛡 *Thank you for telling us.* Our team has been alerted and will contact you.\n\n• Messages between you and this person through the bot are now blocked.\n• Any rating they leave you on this job is on hold.` +
            (rematched ? '' : `\n• If you feel unsafe, leave and call *${EMERGENCY_NUMBER}*.`)
        : '📨 Thanks. Our team will review your report and contact you if needed.',
      rematched ? undefined : KeyboardBuilder.customerMainMenu()
    );
    return true;
  }

  // ---------------------------------------------------------------- 🚨 Safety during an active job
  const safetyId = cb(ctx, 'safety:');
  if (safetyId) {
    const p = await getParticipation(ctx, safetyId);
    if (!p) return true;
    await reply(
      ctx,
      `🚨 *Safety*\n\nIf you are in immediate danger, *leave and call ${EMERGENCY_NUMBER}* now.\n\nYou can also:`,
      {
        inline_keyboard: [
          [{ text: '🆘 Alert HomeOps now', callback_data: `safety_alert:${safetyId}` }],
          [{ text: '📤 Share job details with someone', callback_data: `safety_share:${safetyId}` }],
          [{ text: `🚩 Report the ${p.asCustomer ? 'technician' : 'customer'}`, callback_data: `rep:${safetyId}` }],
        ],
      }
    );
    return true;
  }

  const shareId = cb(ctx, 'safety_share:');
  if (shareId) {
    const p = await getParticipation(ctx, shareId);
    if (!p) return true;
    const r = p.req;
    await reply(
      ctx,
      `🛡 *HomeOps job \`${r.request_number}\`*\n` +
        `🛠 ${escapeMd(r.category?.name ?? '')} - ${escapeMd(r.issue?.name ?? '')}\n` +
        `🕐 ${formatWindow(r.preferred_start_time, r.preferred_end_time)}\n` +
        `📍 ${escapeMd(r.service_address_text ?? '-')}\n` +
        `${p.asCustomer ? '👷 Technician' : '👤 Customer'}: ${escapeMd(p.other.name ?? '-')}\n\n` +
        `If you can't reach me, contact HomeOps Support through the HomeOps Telegram bot.`
    );
    await reply(ctx, '👆 *Forward the message above* to a family member or friend (long-press it, then Forward).');
    return true;
  }

  const alertId = cb(ctx, 'safety_alert:');
  if (alertId) {
    const p = await getParticipation(ctx, alertId);
    if (!p?.other.profileId) return true;
    await fileSafetyReport(supabase, ctx.sender, ctx.config.supportChatId, {
      requestId: alertId,
      requestNumber: p.req.request_number,
      reporterProfileId: profile.id,
      reporterName: `${profile.full_name} (${p.asCustomer ? 'customer' : 'technician'}), TG ${u.userId}${profile.phone_number ? `, ${profile.phone_number}` : ''}`,
      againstProfileId: p.other.profileId,
      category: 'UNSAFE',
      description: 'SOS: the user pressed "Alert HomeOps now" during the job. Contact them immediately.',
    });
    await setStep(ctx, 'SAFETY_LOCATION', { requestId: alertId, requestNumber: p.req.request_number });
    await reply(
      ctx,
      `🆘 *HomeOps has been alerted* and will contact you.\n\nIf you are in danger, call *${EMERGENCY_NUMBER}* now.\n\nYou can also share your current location with our team:`,
      KeyboardBuilder.requestLocationKeyboard('📍 Share my location with HomeOps')
    );
    return true;
  }

  if (inStep(ctx, 'SAFETY_LOCATION') && u.location) {
    const { requestNumber } = ctx.session!.data as { requestNumber: string };
    await clearStep(ctx);
    await alertOperators(
      ctx.sender,
      ctx.config.supportChatId,
      `📍 *SOS location* for \`${requestNumber}\` from ${escapeMd(profile.full_name)}: https://maps.google.com/?q=${u.location.latitude},${u.location.longitude}`
    );
    await reply(ctx, '📍 Location sent to the HomeOps team.', KeyboardBuilder.removeKeyboard());
    return true;
  }

  // ---------------------------------------------------------------- relay block (harassment)
  const blockId = cb(ctx, 'relay_block:');
  if (blockId) {
    const p = await getParticipation(ctx, blockId);
    if (!p) return true;
    await supabase.from('assignment_conversations').update({ relay_status: 'BLOCKED', closed_at: new Date().toISOString() }).eq('service_request_id', blockId);
    if (p.other.profileId) {
      await submitComplaint(supabase, {
        serviceRequestId: blockId,
        reportedByProfileId: profile.id,
        reportedAgainstProfileId: p.other.profileId,
        complaintType: 'Blocked in chat relay',
        description: `The ${p.asCustomer ? 'customer' : 'technician'} blocked messages from the other party.`,
      });
    }
    await reply(ctx, "🚫 Blocked. You won't receive their messages through the bot any more, and our team has been notified.");
    return true;
  }

  // ---------------------------------------------------------------- review reminders
  const skipId = cb(ctx, 'rskip:');
  if (skipId) {
    if (await getParticipation(ctx, skipId)) {
      await supabase.from('review_skips').upsert({ service_request_id: skipId, profile_id: profile.id }, { onConflict: 'service_request_id,profile_id' });
    }
    await reply(ctx, "👍 Okay, we won't ask about this job again.");
    return true;
  }
  if (u.callbackData === 'rlater') {
    await reply(ctx, "👍 No problem, we'll remind you next time.");
    return true;
  }

  return false;
}

/**
 * When someone opens the bot (/start, /technician, menu), remind them about the most recent
 * job they still need to act on: a customer who never confirmed a finished job, or anyone who
 * hasn't reviewed the other party. Sends at most one reminder; the normal menu follows.
 */
export async function remindPendingReview(ctx: BotContext): Promise<void> {
  const { supabase, profile } = ctx;
  const since = new Date(Date.now() - REMINDER_WINDOW_MS).toISOString();
  const fields = 'id, request_number, status, category:service_categories(name)';

  const { data: tech } = await supabase.from('technician_profiles').select('id').eq('profile_id', profile.id).maybeSingle();
  const [{ data: asCustomer }, { data: asTechnician }] = await Promise.all([
    supabase
      .from('service_requests')
      .select(`${fields}, other:technician_profiles!service_requests_assigned_technician_id_fkey(profile:profiles!technician_profiles_profile_id_fkey(full_name))`)
      .eq('customer_id', profile.id)
      .in('status', ['CUSTOMER_CONFIRMATION_PENDING', ...CUSTOMER_RATABLE])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10),
    tech
      ? supabase
          .from('service_requests')
          .select(`${fields}, other:profiles!service_requests_customer_id_fkey(full_name)`)
          .eq('assigned_technician_id', tech.id)
          .in('status', TECHNICIAN_RATABLE)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const jobs = [
    ...((asCustomer ?? []) as any[]).map((j) => ({ ...j, mine: 'customer' as const, otherName: j.other?.profile?.full_name })),
    ...((asTechnician ?? []) as any[]).map((j) => ({ ...j, mine: 'technician' as const, otherName: j.other?.full_name })),
  ];
  if (!jobs.length) return;

  const ids = jobs.map((j) => j.id);
  const [{ data: rated }, { data: skipped }] = await Promise.all([
    supabase.from('ratings').select('service_request_id').eq('reviewer_id', profile.id).in('service_request_id', ids),
    supabase.from('review_skips').select('service_request_id').eq('profile_id', profile.id).in('service_request_id', ids),
  ]);
  const done = new Set([...(rated ?? []), ...(skipped ?? [])].map((r) => r.service_request_id));

  const job = jobs.find((j) => !done.has(j.id));
  if (!job) return;
  const label = `\`${job.request_number}\` (${escapeMd(job.category?.name ?? 'service')})`;

  // A customer who never confirmed the finished job: ask for that first (the review follows it).
  if (job.mine === 'customer' && job.status === 'CUSTOMER_CONFIRMATION_PENDING') {
    await reply(ctx, `🏁 *Your technician marked ${label} as complete.* Was the work done?`, KeyboardBuilder.customerConfirmCompletion(job.id));
    return;
  }

  const who = escapeMd(job.otherName ?? (job.mine === 'customer' ? 'your technician' : 'the customer'));
  await reply(ctx, `⭐ *You haven't reviewed ${label} yet.*\n\nHow was your experience with ${who}?`, {
    inline_keyboard: [
      ...KeyboardBuilder.ratingButtons(job.id).inline_keyboard,
      [
        { text: '⏰ Remind me later', callback_data: 'rlater' },
        { text: '🙈 Skip this review', callback_data: `rskip:${job.id}` },
      ],
    ],
  });
}

/**
 * Rating-farming signals (a technician using a friend's or their own second account as "customer"):
 * the same phone number on both profiles, or the same pair completing 3+ jobs in 30 days.
 */
async function checkCollusion(ctx: BotContext, requestId: string, technicianId: string, technicianProfileId: string): Promise<void> {
  const { supabase, profile } = ctx;
  const [{ data: techProfile }, { count: pairJobs }] = await Promise.all([
    supabase.from('profiles').select('phone_number').eq('id', technicianProfileId).single(),
    supabase
      .from('service_requests')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', profile.id)
      .eq('assigned_technician_id', technicianId)
      .in('status', ['COMPLETED', 'PARTIALLY_COMPLETED'])
      .gte('created_at', new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
  ]);
  const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '').slice(-10);
  if (profile.phone_number && digits(profile.phone_number) === digits(techProfile?.phone_number)) {
    await raiseFlag(supabase, {
      requestId,
      againstProfileId: technicianProfileId,
      type: 'Shared phone number',
      details: 'Customer and technician profiles have the same phone number (possible self-booking).',
      needsReview: true,
    });
  }
  if ((pairJobs ?? 0) >= 3) {
    await raiseFlag(supabase, {
      requestId,
      againstProfileId: technicianProfileId,
      type: 'Repeat customer-technician pair',
      details: `${pairJobs} completed jobs between this customer and technician in 30 days. Check the ratings are genuine.`,
    });
  }
}

/** Asks one party to rate the other (sent to both sides when the customer confirms the job). */
export async function promptRating(ctx: BotContext, requestId: string, otherName: string | null, asCustomer: boolean, chatId?: number): Promise<void> {
  await ctx.sender.sendMessage({
    chatId: chatId ?? ctx.u.chatId,
    text: `⭐ *How was your experience with ${escapeMd(otherName ?? (asCustomer ? 'the technician' : 'the customer'))}?*\n\nYour rating helps keep HomeOps safe and reliable for everyone.`,
    replyMarkup: KeyboardBuilder.ratingButtons(requestId),
  });
}

function tagList(aboutTechnician: boolean, score: number): string[] {
  const set = aboutTechnician ? REVIEW_TAGS.ABOUT_TECHNICIAN : REVIEW_TAGS.ABOUT_CUSTOMER;
  return score >= 4 ? set.good : set.bad;
}

function tagsKeyboard(requestId: string, aboutTechnician: boolean, score: number, selected: string[]): InlineKeyboardMarkup {
  const buttons = tagList(aboutTechnician, score).map((t, i) => ({
    text: `${selected.includes(t) ? '✅ ' : ''}${t}`,
    callback_data: `rtag:${i}:${requestId}`,
  }));
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([
    { text: '📝 Add a comment', callback_data: `rcomment:${requestId}` },
    { text: '✅ Done', callback_data: `rdone:${requestId}` },
  ]);
  return { inline_keyboard: rows };
}

async function thankForFeedback(ctx: BotContext): Promise<void> {
  const isTech = ctx.profile.role === 'TECHNICIAN';
  await reply(
    ctx,
    '🙏 Thanks for your feedback!',
    isTech ? { inline_keyboard: [[{ text: '⬅️ Technician menu', callback_data: 'cmd_tech_portal' }]] } : KeyboardBuilder.customerMainMenu()
  );
}

/** The request if the current user is its customer or its assigned technician, plus who "the other party" is. */
export async function getParticipation(ctx: BotContext, requestId: string) {
  const { data } = await ctx.supabase
    .from('service_requests')
    .select(
      'id, request_number, status, payment_declaration, customer_id, preferred_start_time, preferred_end_time, start_pin, service_address_text, ' +
        'category:service_categories(name), issue:issue_types(name), ' +
        'customer:profiles!service_requests_customer_id_fkey(telegram_user_id, full_name), ' +
        'technician:technician_profiles!service_requests_assigned_technician_id_fkey(id, profile_id, profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id, full_name))'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (!data) return null;
  const req = data as any;
  const asCustomer = req.customer_id === ctx.profile.id;
  const asTechnician = req.technician?.profile_id === ctx.profile.id;
  if (!asCustomer && !asTechnician) return null;
  const other = asCustomer
    ? { profileId: req.technician?.profile_id as string | undefined, chat: req.technician?.profile?.telegram_user_id as number | undefined, name: req.technician?.profile?.full_name as string | null }
    : { profileId: req.customer_id as string, chat: req.customer?.telegram_user_id as number | undefined, name: req.customer?.full_name as string | null };
  return { req, asCustomer, other };
}

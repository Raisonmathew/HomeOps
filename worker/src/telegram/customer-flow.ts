import { BotContext, reply, setStep, clearStep, cb, inStep } from './context';
import { KeyboardBuilder } from './keyboard-builder';
import { timeWindowOptions, formatWindow, escapeMd } from './format';
import { BOT_TEXTS, SEARCH_CONFIG, LIMITS_CONFIG, CANCEL_REASONS } from '../config/constants';
import { raiseFlag, customerReliabilityStrikes } from '../trust/flags';
import { createServiceRequest } from '../customers/customer-requests';
import { getCustomerSavedAddresses, saveCustomerAddress } from '../customers/saved-addresses';
import { cancelServiceRequest, reopenSearch } from '../requests/cancellation';
import { confirmCustomerCompletion } from '../requests/completion';
import { logRequestEvent } from '../security/audit-events';
import { getProfileRating } from '../trust/ratings';
import { submitComplaint } from '../trust/complaints';
import { reverseGeocode } from '../services/geocode';
import { runSearchBatch, startRematch } from '../matching/search';
import { SEARCH_FIELDS, toSearchRequest } from '../matching/candidates';

const CUSTOMER_CANCELLABLE = ['DRAFT', 'REQUESTED', 'SEARCHING', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE'];
const ABORT_ROW = [{ text: '❌ Cancel', callback_data: 'cust_abort' }];
const MAX_PHOTOS = 3; // spec §18.4
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_RETENTION_MS = 90 * 24 * 3600_000; // spec §12 (daily job deletes expired references)

/** This customer's photos uploaded during the current request flow, not yet attached to a request. */
function draftPhotos(ctx: BotContext) {
  return {
    select: (cols: string, opts?: { count: 'exact'; head: boolean }) =>
      ctx.supabase
        .from('attachments')
        .select(cols, opts)
        .eq('uploaded_by', ctx.profile.id)
        .eq('attachment_type', 'ISSUE_PHOTO')
        .is('service_request_id', null),
  };
}

async function deleteDraftPhotos(ctx: BotContext): Promise<void> {
  await ctx.supabase
    .from('attachments')
    .delete()
    .eq('uploaded_by', ctx.profile.id)
    .eq('attachment_type', 'ISSUE_PHOTO')
    .is('service_request_id', null);
}

// Assigned technician's profile + chat, embedded from a service_requests row.
const ASSIGNED_TECH =
  'technician:technician_profiles!service_requests_assigned_technician_id_fkey(profile_id, profile:profiles!technician_profiles_profile_id_fkey(telegram_user_id))';

/** Customer-side bot flows. Returns true if the update was handled. */
export async function handleCustomer(ctx: BotContext): Promise<boolean> {
  const { u, supabase, profile } = ctx;
  const data = (ctx.session?.data ?? {}) as Record<string, any>;

  // ---------------------------------------------------------------- menu / abort
  if (u.text === '/start' || u.callbackData === 'cmd_customer_portal') {
    await clearStep(ctx);
    // Everyone is a customer; people who applied as technicians also see where that stands.
    const { data: tech } = await supabase.from('technician_profiles').select('verification_status').eq('profile_id', profile.id).maybeSingle();
    const techLine: Record<string, string> = {
      APPLIED: '🔧 Technician application: *submitted, waiting for review*. We will message you here when you are approved.',
      UNDER_REVIEW: '🔧 Technician application: *being reviewed*. We will message you here when you are approved.',
      APPROVED: '🔧 You are also an *approved technician*: tap 🛠 Switch / Apply as Technician to go online and see jobs.',
      REJECTED: '🔧 Technician application: *not approved*. Contact 🆘 Support for details.',
      SUSPENDED: '🔧 Technician profile: *suspended*. Contact 🆘 Support for details.',
    };
    await reply(
      ctx,
      `${BOT_TEXTS.WELCOME_CUSTOMER}\n\n👤 You are in the *customer menu*.${tech ? `\n${techLine[tech.verification_status] ?? ''}` : ''}`,
      KeyboardBuilder.customerMainMenu()
    );
    return true;
  }
  if (u.callbackData === 'cust_abort') {
    await clearStep(ctx);
    await deleteDraftPhotos(ctx);
    await reply(ctx, 'Cancelled. Nothing was submitted.', KeyboardBuilder.removeKeyboard());
    await reply(ctx, 'What would you like to do?', KeyboardBuilder.customerMainMenu());
    return true;
  }

  // ---------------------------------------------------------------- new request (spec §6.4)
  if (u.callbackData === 'cmd_new_request') {
    await clearStep(ctx);
    // Spam / fake-request protection: restricted accounts can't book, and open requests are capped.
    if (profile.account_status === 'RESTRICTED') {
      await reply(ctx, '⚠️ Your account is restricted from booking new requests. Please contact Support from the menu.', KeyboardBuilder.customerMainMenu());
      return true;
    }
    const { count: open } = await supabase
      .from('service_requests')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', profile.id)
      .in('status', ['SEARCHING', 'ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS', 'CUSTOMER_CONFIRMATION_PENDING']);
    if ((open ?? 0) >= LIMITS_CONFIG.MAX_OPEN_REQUESTS) {
      await reply(
        ctx,
        `You already have ${open} open requests. Please finish or cancel one before booking another.`,
        { inline_keyboard: [[{ text: '📋 My Requests', callback_data: 'cmd_my_requests' }]] }
      );
      return true;
    }
    const { data: categories } = await supabase
      .from('service_categories')
      .select('id, name')
      .eq('active', true)
      .order('display_order', { ascending: true });
    if (!categories?.length) {
      await reply(ctx, 'No services are available right now. Please try again later.', KeyboardBuilder.customerMainMenu());
      return true;
    }
    await reply(ctx, '🛠 *What do you need help with?*', {
      inline_keyboard: [...(categories ?? []).map((c) => [{ text: c.name, callback_data: `cat:${c.id}` }]), ABORT_ROW],
    });
    return true;
  }

  const catId = cb(ctx, 'cat:');
  if (catId) {
    const { data: issues } = await supabase
      .from('issue_types')
      .select('id, name')
      .eq('service_category_id', catId)
      .eq('active', true);
    await reply(ctx, '🔧 *Which problem best describes it?*', {
      inline_keyboard: [
        ...(issues ?? []).map((i) => [{ text: i.name, callback_data: `iss:${i.id}` }]),
        [{ text: '⬅️ Back', callback_data: 'cmd_new_request' }],
      ],
    });
    return true;
  }

  const issId = cb(ctx, 'iss:');
  if (issId) {
    const { data: issue } = await supabase
      .from('issue_types')
      .select('id, name, urgency_level, safety_message, service_category_id, category:service_categories(name)')
      .eq('id', issId)
      .eq('active', true)
      .maybeSingle();
    if (!issue) {
      await reply(ctx, 'That option is no longer available.', KeyboardBuilder.customerMainMenu());
      return true;
    }
    if (issue.safety_message) await reply(ctx, `${BOT_TEXTS.SAFETY_HEADER}\n\n${issue.safety_message}`);
    await setStep(ctx, 'CUST_DESCRIPTION', {
      categoryId: issue.service_category_id,
      categoryName: (issue as any).category?.name ?? '',
      issueTypeId: issue.id,
      issueName: issue.name,
      urgency: issue.urgency_level,
    });
    await reply(ctx, '📝 *Describe the problem in a sentence or two.*\n\nFor example: "Kitchen sink pipe leaking since morning".', {
      inline_keyboard: [[{ text: '⏭ Skip', callback_data: 'cust_desc_skip' }], ABORT_ROW],
    });
    return true;
  }

  if (inStep(ctx, 'CUST_DESCRIPTION') && (u.text || u.callbackData === 'cust_desc_skip')) {
    const description = u.text?.trim() || `${data.issueName} service requested`;
    if (description.length > 1000) {
      await reply(ctx, 'Please keep the description under 1000 characters.');
      return true;
    }
    await setStep(ctx, 'CUST_PHOTOS', { ...data, description });
    // Drafts from an earlier, abandoned request must not attach to this one.
    await deleteDraftPhotos(ctx);
    await reply(ctx, `📷 *Add up to ${MAX_PHOTOS} photos of the problem* (optional). They help the technician come prepared.`, {
      inline_keyboard: [[{ text: '⏭ Skip photos', callback_data: 'cust_photos_done' }], ABORT_ROW],
    });
    return true;
  }

  // ---------------------------------------------------------------- issue photos (spec §6.4 step 6, §18.4)
  if (inStep(ctx, 'CUST_PHOTOS') && (u.photoFileId || u.otherMedia)) {
    if (!u.photoFileId) {
      await reply(ctx, 'Please send photos only (not files, videos or voice notes).');
      return true;
    }
    if ((u.photoFileSize ?? 0) > MAX_PHOTO_BYTES) {
      await reply(ctx, 'That photo is too large. Please send a smaller one.');
      return true;
    }
    // Stored as draft rows (no request yet) instead of in the session: albums arrive as parallel updates.
    const { count } = await draftPhotos(ctx).select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= MAX_PHOTOS) {
      await reply(ctx, `You've already added ${MAX_PHOTOS} photos.`, { inline_keyboard: [[{ text: '➡️ Continue', callback_data: 'cust_photos_done' }]] });
      return true;
    }
    // Photos stay on Telegram: only the file_id is stored, never a download URL (spec §18.4)
    await supabase.from('attachments').insert({
      uploaded_by: profile.id,
      telegram_file_id: u.photoFileId,
      telegram_file_unique_id: u.photoFileUniqueId ?? null,
      file_size_bytes: u.photoFileSize ?? null,
      mime_type: 'image/jpeg',
      attachment_type: 'ISSUE_PHOTO',
    });
    await reply(ctx, `✅ Photo ${Math.min((count ?? 0) + 1, MAX_PHOTOS)}/${MAX_PHOTOS} added. Send more, or continue.`, {
      inline_keyboard: [[{ text: '➡️ Continue', callback_data: 'cust_photos_done' }]],
    });
    return true;
  }

  if (inStep(ctx, 'CUST_PHOTOS') && u.callbackData === 'cust_photos_done') {
    await setStep(ctx, 'CUST_LOCATION', data);
    await reply(
      ctx,
      '📍 *Where is the service needed?*\n\nTap the button below to share the location. You can move the pin on the map to the exact spot.',
      KeyboardBuilder.requestLocationKeyboard('📍 Share Service Location')
    );
    const saved = await getCustomerSavedAddresses(supabase, profile.id);
    if (saved.length) {
      await reply(ctx, 'Or use a saved address:', {
        inline_keyboard: saved.map((a) => [{ text: `🏠 ${a.label}`, callback_data: `addr_use:${a.id}` }]),
      });
    }
    return true;
  }

  if (inStep(ctx, 'CUST_LOCATION') && u.location) {
    const { latitude, longitude } = u.location;
    const place = await reverseGeocode(latitude, longitude);
    await setStep(ctx, 'CUST_ADDRESS', {
      ...data,
      latitude,
      longitude,
      address: place?.address ?? null,
      locality: place?.locality ?? null,
      fromSaved: false,
    });
    await reply(
      ctx,
      `${place ? `📍 ${escapeMd(place.address)}\n\n` : ''}🏢 *Add your flat/house number and a landmark* so the technician can find you.`,
      { inline_keyboard: [[{ text: '⏭ Skip', callback_data: 'cust_addr_skip' }], ABORT_ROW] }
    );
    return true;
  }

  const savedAddrId = inStep(ctx, 'CUST_LOCATION') ? cb(ctx, 'addr_use:') : null;
  if (savedAddrId) {
    const { data: a } = await supabase
      .from('customer_addresses')
      .select('*')
      .eq('id', savedAddrId)
      .eq('customer_id', profile.id)
      .eq('active', true)
      .maybeSingle();
    if (!a) {
      await reply(ctx, 'That address is no longer saved. Please share the location with the button.');
      return true;
    }
    await setStep(ctx, 'CUST_TIME', {
      ...data,
      latitude: Number(a.latitude),
      longitude: Number(a.longitude),
      address: a.address_text,
      locality: a.locality,
      fromSaved: true,
    });
    await reply(ctx, `📍 Using *${escapeMd(a.label)}*`, KeyboardBuilder.removeKeyboard());
    await askTimeWindow(ctx);
    return true;
  }

  if (inStep(ctx, 'CUST_ADDRESS') && (u.text || u.callbackData === 'cust_addr_skip')) {
    const details = u.text?.trim().slice(0, 300);
    const address =
      [details, data.address].filter(Boolean).join(', ') || `${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}`;
    await setStep(ctx, 'CUST_TIME', { ...data, address });
    await askTimeWindow(ctx);
    return true;
  }

  const timeKey = inStep(ctx, 'CUST_TIME') ? cb(ctx, 'time:') : null;
  if (timeKey) {
    const options = timeWindowOptions();
    const opt = options.find((o) => o.key === timeKey) ?? options[0];
    const next: Record<string, any> = { ...data, start: opt.start.toISOString(), end: opt.end.toISOString() };
    if (!profile.phone_number) {
      // Optional: lets the technician call (a bot can't place Telegram calls). Skipping is fine.
      await setStep(ctx, 'CUST_PHONE', next);
      await reply(
        ctx,
        '📱 *Share your phone number?* (optional)\n\nThe technician can then call you, e.g. when they arrive. Without it they can only message you through this chat. You can remove it any time under 🔒 Privacy.',
        KeyboardBuilder.requestContactKeyboard('📱 Share my number')
      );
      await reply(ctx, 'Or:', { inline_keyboard: [[{ text: '⏭ Skip', callback_data: 'cust_phone_skip' }]] });
      return true;
    }
    await showSummary(ctx, next);
    return true;
  }

  if (inStep(ctx, 'CUST_PHONE') && (u.contact || u.callbackData === 'cust_phone_skip')) {
    if (u.contact) {
      // Only the user's own number: Telegram sets user_id only for the account owner
      if (u.contact.userId !== u.userId) {
        await reply(ctx, 'Please share *your own* number with the button, or tap Skip.');
        return true;
      }
      await supabase.from('profiles').update({ phone_number: u.contact.phoneNumber, phone_number_source: 'SHARED_CONTACT' }).eq('id', profile.id);
      await reply(ctx, '✅ Number saved.', KeyboardBuilder.removeKeyboard());
    } else {
      await reply(ctx, 'No problem.', KeyboardBuilder.removeKeyboard());
    }
    await showSummary(ctx, data);
    return true;
  }

  if (inStep(ctx, 'CUST_CONFIRM') && (u.callbackData === 'cust_confirm' || u.callbackData === 'cust_confirm_save')) {
    // Atomically consume the session so a double tap can't create two requests.
    const { data: consumed } = await supabase
      .from('bot_sessions')
      .delete()
      .eq('telegram_user_id', u.userId)
      .eq('step', 'CUST_CONFIRM')
      .select('telegram_user_id');
    if (!consumed?.length) return true;

    // Scheduled slots wait for the cron to start the search shortly before the slot (spec §6.5 time overlap)
    const startSearchNow = new Date(data.start).getTime() <= Date.now() + SEARCH_CONFIG.LEAD_TIME_HOURS * 3600_000;
    const req = await createServiceRequest(supabase, {
      startSearchNow,
      customerId: profile.id,
      serviceCategoryId: data.categoryId,
      issueTypeId: data.issueTypeId,
      description: data.description,
      serviceAddressText: data.address,
      serviceLocality: data.locality,
      serviceLatitude: data.latitude,
      serviceLongitude: data.longitude,
      urgency: data.urgency,
      preferredStartTime: data.start,
      preferredEndTime: data.end,
    });
    if (!req) {
      await reply(ctx, '❌ Could not create your request. Please try again.', KeyboardBuilder.customerMainMenu());
      return true;
    }

    if (u.callbackData === 'cust_confirm_save') {
      await saveCustomerAddress(supabase, {
        customerId: profile.id,
        label: data.locality || 'Saved address',
        addressText: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        locality: data.locality,
      });
    }

    // Attach the draft photos (at most MAX_PHOTOS, newest first if an album raced past the cap)
    const { data: drafts } = await draftPhotos(ctx).select('id').order('created_at', { ascending: false }).limit(MAX_PHOTOS);
    if (drafts?.length) {
      await supabase
        .from('attachments')
        .update({ service_request_id: req.id, expires_at: new Date(Date.now() + PHOTO_RETENTION_MS).toISOString() })
        .in('id', (drafts as unknown as { id: string }[]).map((d) => d.id));
    }
    await deleteDraftPhotos(ctx);

    const trackRow = [{ text: '🔎 Track request', callback_data: `req_view:${req.id}` }];
    const cancelRow = [{ text: '❌ Cancel request', callback_data: `req_cancel:${req.id}` }];
    if (!startSearchNow) {
      await reply(
        ctx,
        `📅 *Request \`${req.request_number}\` booked for ${formatWindow(req.preferred_start_time, req.preferred_end_time)}.*\n\n` +
          `We'll start finding a nearby technician about ${SEARCH_CONFIG.LEAD_TIME_HOURS} hours before your slot and message you here.`,
        { inline_keyboard: [trackRow, cancelRow] }
      );
      return true;
    }
    await reply(
      ctx,
      `🔎 *Looking for a nearby verified technician...*\nRequest \`${req.request_number}\`\n\nWe'll message you here as soon as someone accepts. This usually takes a few minutes.`,
      { inline_keyboard: [trackRow, cancelRow] }
    );
    await runSearchBatch(supabase, ctx.sender, toSearchRequest({ ...req, category: { name: data.categoryName }, issue: { name: data.issueName } }), 1);
    return true;
  }

  // ---------------------------------------------------------------- my requests & cancellation
  if (u.callbackData === 'cmd_my_requests') {
    const { data: reqs } = await supabase
      .from('service_requests')
      .select('id, request_number, status, preferred_start_time, preferred_end_time, category:service_categories(name), issue:issue_types(name)')
      .eq('customer_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(5);

    const lines = (reqs ?? []).map(
      (r: any) =>
        `• \`${r.request_number}\` ${escapeMd(r.category?.name ?? '')} - ${escapeMd(r.issue?.name ?? '')}\n   \`${r.status}\` · ${formatWindow(r.preferred_start_time, r.preferred_end_time)}`
    );
    const viewRows = (reqs ?? []).map((r: any) => [
      { text: `🔎 ${r.request_number}${CUSTOMER_CANCELLABLE.includes(r.status) ? ' (track / cancel)' : ''}`, callback_data: `req_view:${r.id}` },
    ]);
    const myRating = await getProfileRating(supabase, profile.id);
    const ratingLine = myRating.count ? `⭐ Your rating from technicians: *${myRating.avg.toFixed(1)}/5* (${myRating.count})\n\n` : '';

    await reply(ctx, lines.length ? `📋 *Your recent requests*\n\n${ratingLine}${lines.join('\n')}` : 'You have no service requests yet.', {
      inline_keyboard: [...viewRows, [{ text: '⬅️ Menu', callback_data: 'cmd_customer_portal' }]],
    });
    return true;
  }

  // ---------------------------------------------------------------- customer cancellation (by stage)
  //  SEARCHING / ASSIGNED          → free cancel
  //  CONTACTED / DISCUSSING_SCOPE  → reason required, counts as a late cancellation
  //  AGREED / IN_PROGRESS          → can't cancel in the bot; ask HomeOps (operator decides)
  const cancelId = cb(ctx, 'req_cancel:');
  if (cancelId) {
    const r = await getOwnRequest(ctx, cancelId);
    if (!r) return true;
    const no = { text: 'No, keep it', callback_data: `req_view:${cancelId}` };
    if (['DRAFT', 'REQUESTED', 'SEARCHING', 'ASSIGNED'].includes(r.status)) {
      await reply(ctx, `Cancel \`${r.request_number}\`?`, {
        inline_keyboard: [[{ text: '✅ Yes, cancel it', callback_data: `creason:NONE:${cancelId}` }, no]],
      });
    } else if (['CONTACTED', 'DISCUSSING_SCOPE'].includes(r.status)) {
      await reply(
        ctx,
        `The technician has already contacted you about \`${r.request_number}\`. *Why are you cancelling?*\n\n_Late cancellations count toward your account's reliability._`,
        {
          inline_keyboard: [
            ...Object.entries(CANCEL_REASONS.CUSTOMER).map(([code, label]) => [{ text: label, callback_data: `creason:${code}:${cancelId}` }]),
            [no],
          ],
        }
      );
    } else if (['AGREED', 'IN_PROGRESS'].includes(r.status)) {
      await reply(
        ctx,
        `Work on \`${r.request_number}\` has been agreed or started, so it can't be cancelled here. Our team can step in and talk to both of you.`,
        { inline_keyboard: [[{ text: '🆘 Ask HomeOps to cancel', callback_data: `req_opcancel:${cancelId}` }], [no]] }
      );
    } else {
      await reply(ctx, `\`${r.request_number}\` is \`${r.status}\` and can no longer be cancelled.`);
    }
    return true;
  }

  // req_cancel_yes: is the pre-reason button format on older messages
  const reasonCb = cb(ctx, 'creason:') ?? (cb(ctx, 'req_cancel_yes:') !== null ? `NONE:${cb(ctx, 'req_cancel_yes:')}` : null);
  if (reasonCb) {
    const [code, requestId] = reasonCb.split(':');
    const r = await getOwnRequest(ctx, requestId);
    if (!r) return true;
    const label = (CANCEL_REASONS.CUSTOMER as Record<string, string>)[code] ?? 'No reason given';
    const result = await cancelServiceRequest(supabase, requestId, profile.id, 'CUSTOMER', `Customer: ${label}`, code);
    if (!result.success) {
      await reply(ctx, `\`${r.request_number}\` can't be cancelled now (status \`${result.oldStatus ?? r.status}\`).`, {
        inline_keyboard: [[{ text: '🔎 Track request', callback_data: `req_view:${requestId}` }]],
      });
      return true;
    }
    await reply(ctx, `✅ \`${r.request_number}\` has been cancelled.`, KeyboardBuilder.customerMainMenu());
    const tech = r.technician;
    if (tech?.profile?.telegram_user_id) {
      await ctx.sender.sendMessage({
        chatId: tech.profile.telegram_user_id,
        text: `ℹ️ The customer cancelled \`${r.request_number}\`${code !== 'NONE' ? ` (${label})` : ''}. No further action is needed.`,
      });
    }
    // Repeated late cancellations / no-shows waste technicians' trips: flag for operators
    if (['CONTACTED', 'DISCUSSING_SCOPE'].includes(r.status)) {
      const strikes = await customerReliabilityStrikes(supabase, profile.id);
      if (strikes >= LIMITS_CONFIG.LATE_CANCEL_FLAG_COUNT) {
        await raiseFlag(supabase, {
          requestId,
          againstProfileId: profile.id,
          type: 'Repeated late cancellations',
          details: `${strikes} late cancellations or no-shows in the last 30 days.`,
        });
      }
    }
    return true;
  }

  const opCancelId = cb(ctx, 'req_opcancel:');
  if (opCancelId) {
    const r = await getOwnRequest(ctx, opCancelId);
    if (!r?.technician) return true;
    await submitComplaint(supabase, {
      serviceRequestId: opCancelId,
      reportedByProfileId: profile.id,
      reportedAgainstProfileId: r.technician.profile_id,
      complaintType: 'Cancellation request',
      description: `Customer asked HomeOps to cancel after work was ${r.status === 'AGREED' ? 'agreed' : 'started'}.`,
    });
    await supabase.from('service_requests').update({ operator_review_required: true }).eq('id', opCancelId);
    await reply(ctx, '📨 Our team has been asked to step in. They will contact you and the technician.', KeyboardBuilder.customerMainMenu());
    return true;
  }

  // "I haven't heard from my technician": release them and search again (customer protection)
  const noContactId = cb(ctx, 'req_nocontact:');
  if (noContactId) {
    const r = await getOwnRequest(ctx, noContactId);
    if (!r?.technician) return true;
    const rematch = await reopenSearch(supabase, noContactId, profile.id, 'CUSTOMER_REQUESTED_ANOTHER_TECHNICIAN', 'Customer reported no contact from technician', [
      'ASSIGNED',
      'CONTACTED',
    ]);
    if (!rematch) {
      await reply(ctx, `This isn't possible for \`${r.request_number}\` any more. Use 🆘 Support if you need help.`);
      return true;
    }
    await raiseFlag(supabase, {
      requestId: noContactId,
      againstProfileId: r.technician.profile_id,
      type: r.status === 'CONTACTED' ? 'Claimed contact, customer disagrees' : 'No contact after assignment',
      details: `Customer reported the technician never contacted them (job was ${r.status}).`,
    });
    if (r.technician.profile?.telegram_user_id) {
      await ctx.sender.sendMessage({
        chatId: r.technician.profile.telegram_user_id,
        text: `ℹ️ \`${r.request_number}\` was released because the customer said they hadn't heard from you. The HomeOps team may follow up.`,
      });
    }
    await startRematch(supabase, ctx.sender, r, rematch, u.chatId, 'Sorry about that.');
    return true;
  }

  // ---------------------------------------------------------------- saved addresses
  if (u.callbackData === 'cmd_saved_addresses') {
    await showSavedAddresses(ctx);
    return true;
  }

  const delAddrId = cb(ctx, 'addr_del:');
  if (delAddrId) {
    await supabase.from('customer_addresses').update({ active: false }).eq('id', delAddrId).eq('customer_id', profile.id);
    await reply(ctx, '🗑 Address removed.');
    await showSavedAddresses(ctx);
    return true;
  }

  // ---------------------------------------------------------------- completion, disputes, estimates, ratings
  const problemId = cb(ctx, 'prob:');
  if (problemId) {
    if (!(await getOwnRequest(ctx, problemId))) return true;
    await setStep(ctx, 'CUST_COMPLAINT', { requestId: problemId });
    await reply(ctx, '⚠️ *What went wrong?*\n\nDescribe the problem in a message. Our team will review it and contact you.', {
      inline_keyboard: [ABORT_ROW],
    });
    return true;
  }

  const done = cb(ctx, 'done:');
  if (done) {
    const [kind, requestId] = done.split(':');
    const { data: r } = await supabase
      .from('service_requests')
      .select(`request_number, status, ${ASSIGNED_TECH}`)
      .eq('id', requestId)
      .eq('customer_id', profile.id)
      .maybeSingle();
    if (!r || r.status !== 'CUSTOMER_CONFIRMATION_PENDING') {
      await reply(ctx, `This request is already \`${r?.status ?? 'closed'}\`.`);
      return true;
    }
    if (kind === 'PROBLEM') {
      await setStep(ctx, 'CUST_COMPLAINT', { requestId });
      await reply(ctx, '⚠️ *What went wrong?*\n\nDescribe the problem in a message. Our team will review it and contact you.', {
        inline_keyboard: [ABORT_ROW],
      });
      return true;
    }
    const ok = await confirmCustomerCompletion(supabase, requestId, profile.id, kind === 'PARTIAL');
    if (!ok) {
      await reply(ctx, 'Could not record your confirmation. Please try again.');
      return true;
    }
    // Next: payment declaration, then the rating (asked in shared-flow after the payment answer)
    await reply(ctx, '🙏 Thanks for confirming!\n\n💵 *Did you pay the technician directly?*', KeyboardBuilder.paymentButtons(requestId, true));
    const tech = (r as any).technician;
    if (tech?.profile?.telegram_user_id) {
      await ctx.sender.sendMessage({
        chatId: tech.profile.telegram_user_id,
        text: `✅ The customer confirmed \`${r.request_number}\` as ${kind === 'PARTIAL' ? 'partly completed' : 'completed'}.`,
      });
      // (The technician was already asked for their review at "Work Complete"; reminders cover the rest.)
    }
    return true;
  }

  if (inStep(ctx, 'CUST_COMPLAINT') && u.text) {
    const requestId = data.requestId as string;
    const { data: r } = await supabase
      .from('service_requests')
      .select(`request_number, status, ${ASSIGNED_TECH}`)
      .eq('id', requestId)
      .eq('customer_id', profile.id)
      .maybeSingle();
    await clearStep(ctx);
    const tech = (r as any)?.technician;
    if (!r || !tech) {
      await reply(ctx, 'Request not found.', KeyboardBuilder.customerMainMenu());
      return true;
    }

    const { data: disputed } = await supabase
      .from('service_requests')
      .update({ status: 'DISPUTED', operator_review_required: true })
      .eq('id', requestId)
      .eq('status', 'CUSTOMER_CONFIRMATION_PENDING')
      .select('id');
    if (disputed?.length) {
      await logRequestEvent(supabase, {
        serviceRequestId: requestId,
        eventType: 'DISPUTED',
        oldStatus: 'CUSTOMER_CONFIRMATION_PENDING',
        newStatus: 'DISPUTED',
        performedBy: profile.id,
        notes: 'Customer reported a problem at completion',
      });
    }
    await submitComplaint(supabase, {
      serviceRequestId: requestId,
      reportedByProfileId: profile.id,
      reportedAgainstProfileId: tech.profile_id,
      complaintType: 'Service dispute',
      description: u.text.trim().slice(0, 2000),
    });

    await reply(ctx, '📨 Thank you. Our team will review this and contact you.', KeyboardBuilder.customerMainMenu());
    if (tech.profile?.telegram_user_id) {
      await ctx.sender.sendMessage({
        chatId: tech.profile.telegram_user_id,
        text: `⚠️ The customer reported a problem with \`${r.request_number}\`. The HomeOps team will review it and may contact you.`,
      });
    }
    return true;
  }

  for (const [prefix, ack] of [
    ['est_ack:', 'ACKNOWLEDGED'],
    ['est_dispute:', 'DISPUTED'],
  ] as const) {
    const requestId = cb(ctx, prefix);
    if (!requestId) continue;
    const { data: r } = await supabase
      .from('service_requests')
      .select(`request_number, ${ASSIGNED_TECH}`)
      .eq('id', requestId)
      .eq('customer_id', profile.id)
      .maybeSingle();
    if (!r) return true;
    await supabase
      .from('estimate_records')
      .update({ customer_acknowledgement_status: ack })
      .eq('service_request_id', requestId)
      .eq('customer_acknowledgement_status', 'NOT_REVIEWED');

    const techChat = (r as any).technician?.profile?.telegram_user_id;
    if (ack === 'ACKNOWLEDGED') {
      await reply(ctx, '👍 Thanks, the estimate is marked as acknowledged.');
      if (techChat) await ctx.sender.sendMessage({ chatId: techChat, text: `👍 The customer acknowledged your estimate for \`${r.request_number}\`.` });
    } else {
      await reply(ctx, '⚠️ Noted. Please clarify the price with the technician before work starts. You can message them through this chat.');
      if (techChat) {
        await ctx.sender.sendMessage({
          chatId: techChat,
          text: `⚠️ The customer says the estimate for \`${r.request_number}\` doesn't match what was agreed. Please clarify with them before starting work.`,
        });
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- request another technician (spec §9.4)
  const reassignId = cb(ctx, 'req_reassign:');
  if (reassignId) {
    await reply(ctx, 'Find a different technician for this request? The current technician will be released.', {
      inline_keyboard: [
        [
          { text: '🔁 Yes, find another', callback_data: `req_reassign_yes:${reassignId}` },
          { text: 'No, keep them', callback_data: `req_view:${reassignId}` },
        ],
      ],
    });
    return true;
  }

  const reassignYesId = cb(ctx, 'req_reassign_yes:');
  if (reassignYesId) {
    const { data: r } = await supabase
      .from('service_requests')
      .select(`${SEARCH_FIELDS}, ${ASSIGNED_TECH}`)
      .eq('id', reassignYesId)
      .eq('customer_id', profile.id)
      .maybeSingle();
    const job = r as any;
    const rematch = job && (await reopenSearch(supabase, reassignYesId, profile.id, 'CUSTOMER_REQUESTED_ANOTHER_TECHNICIAN', 'Customer asked for another technician', ['ASSIGNED']));
    if (!rematch) {
      // State machine: only possible before the technician has contacted the customer.
      await reply(ctx, `This is only possible before the technician contacts you. You can still cancel the request from 🔎 Track.`, {
        inline_keyboard: [[{ text: '🔎 Track request', callback_data: `req_view:${reassignYesId}` }]],
      });
      return true;
    }
    if (job.technician?.profile?.telegram_user_id) {
      await ctx.sender.sendMessage({
        chatId: job.technician.profile.telegram_user_id,
        text: `ℹ️ The customer asked for a different technician for \`${job.request_number}\`. No further action is needed.`,
      });
    }
    await startRematch(supabase, ctx.sender, job, rematch, u.chatId, 'Done.');
    return true;
  }

  return false;
}

/** The request if it belongs to this customer (with search fields and the assigned technician). */
async function getOwnRequest(ctx: BotContext, requestId: string): Promise<any | null> {
  const { data } = await ctx.supabase
    .from('service_requests')
    .select(`${SEARCH_FIELDS}, ${ASSIGNED_TECH}`)
    .eq('id', requestId)
    .eq('customer_id', ctx.profile.id)
    .maybeSingle();
  if (!data) await reply(ctx, 'Request not found.', KeyboardBuilder.customerMainMenu());
  return data;
}

/** Step before creating the request: summary, then Confirm (spec §6.4 steps 9-10). */
async function showSummary(ctx: BotContext, next: Record<string, any>): Promise<void> {
  await setStep(ctx, 'CUST_CONFIRM', next);
  await reply(
    ctx,
    `📋 *Please confirm your request*\n\n` +
      `🛠 ${escapeMd(next.categoryName)} - ${escapeMd(next.issueName)}\n` +
      `📝 ${escapeMd(next.description)}\n` +
      `📍 ${escapeMd(next.address)}\n` +
      `🕐 ${formatWindow(next.start, next.end)}\n\n` +
      `_HomeOps finds you a verified technician. Price, scope and payment are agreed directly between you and the technician. HomeOps does not collect payment._`,
    {
      inline_keyboard: [
        [{ text: '✅ Confirm request', callback_data: 'cust_confirm' }],
        ...(next.fromSaved ? [] : [[{ text: '✅ Confirm & save this address', callback_data: 'cust_confirm_save' }]]),
        ABORT_ROW,
      ],
    }
  );
}

async function askTimeWindow(ctx: BotContext): Promise<void> {
  await reply(ctx, '🕐 *When should the technician come?*', {
    inline_keyboard: [...timeWindowOptions().map((o) => [{ text: o.label, callback_data: `time:${o.key}` }]), ABORT_ROW],
  });
}

async function showSavedAddresses(ctx: BotContext): Promise<void> {
  const addresses = await getCustomerSavedAddresses(ctx.supabase, ctx.profile.id);
  if (!addresses.length) {
    await reply(
      ctx,
      'You have no saved addresses yet. When you confirm a request, choose *Confirm & save this address* to save it for next time.',
      KeyboardBuilder.customerMainMenu()
    );
    return;
  }
  await reply(ctx, `📍 *Saved addresses*\n\n${addresses.map((a) => `• *${escapeMd(a.label)}*: ${escapeMd(a.address_text)}`).join('\n')}`, {
    inline_keyboard: [
      ...addresses.map((a) => [{ text: `🗑 Remove ${a.label}`, callback_data: `addr_del:${a.id}` }]),
      [{ text: '⬅️ Menu', callback_data: 'cmd_customer_portal' }],
    ],
  });
}

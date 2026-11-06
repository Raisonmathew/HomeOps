import { BotContext, reply, setStep, clearStep, cb, inStep, ACTIVE_JOB_STATUSES } from './context';
import { KeyboardBuilder } from './keyboard-builder';
import { parseEstimate, escapeMd } from './format';
import { BOT_TEXTS } from '../config/constants';
import { RequestStatus } from '../types/database';
import { applyAsTechnician } from '../technicians/technician-registration';
import { addTechnicianSkill } from '../technicians/skills';
import { setTechnicianOnline, setTechnicianOffline } from '../technicians/availability';
import { processAtomicAssignment } from '../matching/assignment';
import { startRematch } from '../matching/search';
import { markTechnicianComplete } from '../requests/completion';
import { cancelServiceRequest } from '../requests/cancellation';
import { recordEstimate } from '../requests/estimate-record';
import { closeRelay } from '../requests/relay';
import { logRequestEvent } from '../security/audit-events';
import { CustomerNotifications } from '../notifications/customer-notifications';
import { notifyAssignment } from '../notifications/assignment';
import { SEARCH_FIELDS, toSearchRequest } from '../matching/candidates';
import { onlineUntilOptions } from './format';
import { promptRating } from './shared-flow';
import { storeIdDocument } from '../technicians/verification-docs';
import { CANCEL_REASONS, SAFETY_CONFIG, LIMITS_CONFIG } from '../config/constants';
import { REOPENABLE_STATUSES } from '../requests/cancellation';
import { raiseFlag, customerReliabilityStrikes, technicianCancelsThisWeek } from '../trust/flags';

const ID_PROMPT = (title: string) =>
  `${title}\n\n🪪 Send a clear *photo of a government ID* (Aadhaar, PAN, Driving Licence or Voter ID).\n\n` +
  `_It is stored privately and only HomeOps staff can see it. Customers never see it. You may cover the first 8 digits of an Aadhaar number._`;

const JOB_SELECT =`${SEARCH_FIELDS}, customer:profiles!service_requests_customer_id_fkey(telegram_user_id)`;

/** Technician-side bot flows. Returns true if the update was handled. */
export async function handleTechnician(ctx: BotContext): Promise<boolean> {
  const { u, supabase, profile } = ctx;
  const data = (ctx.session?.data ?? {}) as Record<string, any>;

  // ---------------------------------------------------------------- portal
  if (u.text === '/technician' || u.callbackData === 'cmd_tech_portal') {
    await clearStep(ctx);
    const tech = await getTech(ctx);
    if (!tech) {
      await reply(ctx, `${BOT_TEXTS.WELCOME_TECHNICIAN}\n\nWould you like to register as a service technician?`, {
        inline_keyboard: [
          [{ text: '📝 Submit Technician Application', callback_data: 'tech_apply_start' }],
          [{ text: '👤 Back to Customer Menu', callback_data: 'cmd_customer_portal' }],
        ],
      });
      return true;
    }
    if (tech.verification_status !== 'APPROVED') {
      await reply(
        ctx,
        `🔧 *Technician Application*\nStatus: \`${tech.verification_status}\`\n\nAn operator reviews every application. You'll be able to go online once you're approved.`,
        { inline_keyboard: [[{ text: '👤 Switch to Customer Menu', callback_data: 'cmd_customer_portal' }]] }
      );
      return true;
    }
    const online = await isOnline(ctx, tech.id);
    await reply(ctx, `🔧 *Technician Mode*\nStatus: ${online ? '🟢 Online' : '🔴 Offline'}`, KeyboardBuilder.technicianMainMenu(online));
    return true;
  }

  // ---------------------------------------------------------------- application (spec §6.2)
  if (u.callbackData === 'tech_apply_start') {
    const tech = await getTech(ctx);
    if (tech) {
      await reply(ctx, `You have already applied. Status: \`${tech.verification_status}\``);
      return true;
    }
    await setStep(ctx, 'TECH_APPLY_PHONE');
    await reply(
      ctx,
      '📝 *Technician Application (1/6)*\n\nShare your phone number so customers can reach you when you are assigned a job.',
      KeyboardBuilder.requestContactKeyboard('📱 Share My Phone Number')
    );
    return true;
  }

  if (inStep(ctx, 'TECH_APPLY_PHONE') && u.contact) {
    // Reject forwarded/other people's contacts: Telegram sets user_id only for the account owner.
    if (u.contact.userId !== u.userId) {
      await reply(ctx, 'Please share *your own* number using the button below.', KeyboardBuilder.requestContactKeyboard('📱 Share My Phone Number'));
      return true;
    }
    await supabase
      .from('profiles')
      .update({ phone_number: u.contact.phoneNumber, phone_number_source: 'SHARED_CONTACT' })
      .eq('id', profile.id);
    await setStep(ctx, 'TECH_APPLY_ID');
    await reply(ctx, ID_PROMPT('📝 *Technician Application (2/6)*'), KeyboardBuilder.removeKeyboard());
    return true;
  }

  // ---------------------------------------------------------------- ID document (spec §6.2 step 8)
  const idStep = inStep(ctx, 'TECH_APPLY_ID') || inStep(ctx, 'TECH_UPLOAD_ID');
  if (idStep && (u.photoFileId || u.otherMedia)) {
    if (!u.photoFileId) {
      await reply(ctx, 'Please send the ID as a *photo* (not a file).');
      return true;
    }
    const result = await storeIdDocument(supabase, ctx.sender, profile.id, { fileId: u.photoFileId, uniqueId: u.photoFileUniqueId, size: u.photoFileSize });
    if (result !== 'OK') {
      await reply(ctx, result === 'TOO_LARGE' ? 'That photo is too large. Please send a smaller one.' : 'Could not save the photo. Please send it again.');
      return true;
    }
    if (inStep(ctx, 'TECH_UPLOAD_ID')) {
      await clearStep(ctx);
      await reply(ctx, '✅ ID document received. Our team will review it.', profileButtons());
      return true;
    }
    await setStep(ctx, 'TECH_APPLY_EXPERIENCE');
    await reply(ctx, '✅ ID received.\n\n📝 *Technician Application (3/6)*\n\nHow many years of experience do you have?', {
      inline_keyboard: [
        [
          { text: '< 1 year', callback_data: 'tech_exp:0' },
          { text: '1-3 years', callback_data: 'tech_exp:2' },
          { text: '3-5 years', callback_data: 'tech_exp:4' },
        ],
        [
          { text: '5-10 years', callback_data: 'tech_exp:7' },
          { text: '10+ years', callback_data: 'tech_exp:10' },
        ],
      ],
    });
    return true;
  }

  if (u.callbackData === 'tech_upload_id') {
    if (!(await getTech(ctx))) return notTechnician(ctx);
    await setStep(ctx, 'TECH_UPLOAD_ID');
    await reply(ctx, ID_PROMPT('🪪 *Upload ID document*'));
    return true;
  }

  const exp = inStep(ctx, 'TECH_APPLY_EXPERIENCE') ? cb(ctx, 'tech_exp:') : null;
  if (exp !== null) {
    await setStep(ctx, 'TECH_APPLY_SKILLS', { experienceYears: parseInt(exp, 10), categoryIds: [] });
    await sendSkillPicker(ctx, [], [], '📝 *Technician Application (4/6)*\n\nTap every service you can do, then tap *Done*.');
    return true;
  }

  // Skill picker is shared by the application (TECH_APPLY_SKILLS) and "Add skills" (TECH_EDIT_SKILLS)
  const skillStep = inStep(ctx, 'TECH_APPLY_SKILLS') || inStep(ctx, 'TECH_EDIT_SKILLS');
  const toggledCat = skillStep ? cb(ctx, 'tech_skill:') : null;
  if (toggledCat) {
    const selected = (data.categoryIds as string[]) ?? [];
    const categoryIds = selected.includes(toggledCat) ? selected.filter((c) => c !== toggledCat) : [...selected, toggledCat];
    await setStep(ctx, ctx.session!.step, { ...data, categoryIds });
    await sendSkillPicker(ctx, categoryIds, data.existingIds ?? []);
    return true;
  }

  if (skillStep && u.callbackData === 'tech_skill_done') {
    const categoryIds = (data.categoryIds as string[]) ?? [];
    if (!categoryIds.length) {
      await reply(ctx, 'Please select at least one service category.');
      return true;
    }
    if (inStep(ctx, 'TECH_EDIT_SKILLS')) {
      const tech = await getTech(ctx);
      for (const catId of categoryIds) if (tech) await addTechnicianSkill(supabase, tech.id, catId);
      await clearStep(ctx);
      await reply(ctx, '✅ New skills sent for operator approval. You will get matching jobs once they are approved.', profileButtons());
      return true;
    }
    await setStep(ctx, 'TECH_APPLY_LOCATION', data);
    await reply(
      ctx,
      '📝 *Technician Application (5/6)*\n\nShare your *base location* (where you usually start from). It is used to match you with nearby jobs.',
      KeyboardBuilder.requestLocationKeyboard('📍 Share Base Location')
    );
    return true;
  }

  if (inStep(ctx, 'TECH_APPLY_LOCATION') && u.location) {
    await setStep(ctx, 'TECH_APPLY_RADIUS', { ...data, baseLatitude: u.location.latitude, baseLongitude: u.location.longitude });
    await reply(ctx, '📝 *Technician Application (6/6)*\n\nHow far are you willing to travel for a job?', KeyboardBuilder.radiusSelection());
    return true;
  }

  const radius = cb(ctx, 'rad_');
  if (radius && inStep(ctx, 'TECH_APPLY_RADIUS')) {
    const applied = await applyAsTechnician(supabase, profile.id, {
      experienceYears: data.experienceYears,
      baseLatitude: data.baseLatitude,
      baseLongitude: data.baseLongitude,
      defaultRadiusKm: parseInt(radius, 10),
    });
    const tech = await getTech(ctx);
    await clearStep(ctx);
    if (!applied || !tech) {
      console.error(`Technician application failed for profile ${profile.id}`);
      await reply(ctx, '❌ Could not submit your application. Please try again with /technician.');
      return true;
    }
    for (const catId of (data.categoryIds as string[]) ?? []) await addTechnicianSkill(supabase, tech.id, catId);
    await reply(
      ctx,
      '✅ *Application submitted!*\n\nAn operator will review your details and skills. You can go online and receive nearby jobs once approved. Check your status any time with /technician.',
      { inline_keyboard: [[{ text: '👤 Back to Customer Menu', callback_data: 'cmd_customer_portal' }]] }
    );
    return true;
  }

  // ---------------------------------------------------------------- work profile & edits
  if (u.callbackData === 'tech_profile') {
    const { data: tech } = await supabase
      .from('technician_profiles')
      .select(
        'verification_status, probation_status, experience_years, default_radius_km, average_rating, completed_request_count, ' +
          'skills:technician_skills(approval_status, category:service_categories(name))'
      )
      .eq('profile_id', profile.id)
      .maybeSingle();
    if (!tech) return notTechnician(ctx);
    const t = tech as any;
    const skills = (t.skills ?? []).map((s: any) => `• ${escapeMd(s.category?.name ?? '-')}: \`${s.approval_status}\``).join('\n') || '• none';
    await reply(
      ctx,
      `⚙️ *My Work Profile*\n\n` +
        `Verification: \`${t.verification_status}\`\nProbation: \`${t.probation_status}\`\n` +
        `Experience: ${t.experience_years} yrs\nTravel radius: ${t.default_radius_km} km\n` +
        `Rating: ${t.completed_request_count > 0 ? Number(t.average_rating).toFixed(1) : 'new'} · Completed jobs: ${t.completed_request_count}\n\n` +
        `*Skills*\n${skills}`,
      profileButtons()
    );
    return true;
  }

  if (u.callbackData === 'tech_edit_loc') {
    await setStep(ctx, 'TECH_EDIT_LOCATION');
    await reply(ctx, '📍 Share your new *base location*.', KeyboardBuilder.requestLocationKeyboard('📍 Share Base Location'));
    return true;
  }
  if (inStep(ctx, 'TECH_EDIT_LOCATION') && u.location) {
    await supabase
      .from('technician_profiles')
      .update({ base_latitude: u.location.latitude, base_longitude: u.location.longitude })
      .eq('profile_id', profile.id);
    await clearStep(ctx);
    await reply(ctx, '✅ Base location updated.', profileButtons());
    return true;
  }

  if (u.callbackData === 'tech_edit_radius') {
    await setStep(ctx, 'TECH_EDIT_RADIUS');
    await reply(ctx, '📏 How far are you willing to travel for a job?', KeyboardBuilder.radiusSelection());
    return true;
  }
  if (radius && inStep(ctx, 'TECH_EDIT_RADIUS')) {
    const km = parseInt(radius, 10);
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    await supabase.from('technician_profiles').update({ default_radius_km: km }).eq('id', tech.id);
    // Apply to the current online session too, so the change takes effect immediately.
    await supabase.from('technician_availability').update({ effective_radius_km: km }).eq('technician_id', tech.id).eq('availability_status', 'ONLINE');
    await clearStep(ctx);
    await reply(ctx, `✅ Travel radius set to ${km} km.`, profileButtons());
    return true;
  }

  if (u.callbackData === 'tech_edit_skills') {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const { data: existing } = await supabase.from('technician_skills').select('service_category_id').eq('technician_id', tech.id);
    const existingIds = [...new Set((existing ?? []).map((s) => s.service_category_id as string))];
    await setStep(ctx, 'TECH_EDIT_SKILLS', { categoryIds: [], existingIds });
    await sendSkillPicker(ctx, [], existingIds, '➕ *Add skills*\n\nTap the services you want to add, then tap *Done*. An operator approves new skills.');
    return true;
  }

  // ---------------------------------------------------------------- availability (spec §6.3)
  if (u.callbackData === 'tech_go_online') {
    const tech = await getTech(ctx);
    if (!tech || tech.verification_status !== 'APPROVED') {
      await reply(ctx, 'Only approved technicians can go online.');
      return true;
    }
    if (profile.account_status !== 'ACTIVE') {
      await reply(ctx, '⛔ Your account is restricted, so you cannot take new jobs while our team reviews it. Contact Support from the menu.');
      return true;
    }
    await setStep(ctx, 'TECH_ONLINE_LOCATION');
    await reply(
      ctx,
      '📍 *Where are you starting from?*\n\nShare your current location so we can send you nearby jobs.',
      KeyboardBuilder.requestLocationKeyboard('📍 Share Current Location')
    );
    if (tech.base_latitude != null) {
      await reply(ctx, 'Or:', { inline_keyboard: [[{ text: '🏠 Use my base location', callback_data: 'tech_online_base' }]] });
    }
    return true;
  }

  if (inStep(ctx, 'TECH_ONLINE_LOCATION') && (u.location || u.callbackData === 'tech_online_base')) {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const loc = u.location ?? { latitude: Number(tech.base_latitude), longitude: Number(tech.base_longitude) };
    await setStep(ctx, 'TECH_ONLINE_UNTIL', loc);
    await reply(ctx, u.location ? '📍 Location received.' : '🏠 Using your base location.', KeyboardBuilder.removeKeyboard());
    await reply(ctx, '🕐 *How long will you be available?*', {
      inline_keyboard: onlineUntilOptions().map((o) => [{ text: o.label, callback_data: `until:${o.key}` }]),
    });
    return true;
  }

  const until = inStep(ctx, 'TECH_ONLINE_UNTIL') ? cb(ctx, 'until:') : null;
  if (until) {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const option = onlineUntilOptions().find((o) => o.key === until) ?? { hours: 8, label: '8 hours' };
    const radiusKm = Number(tech.default_radius_km) || 8;
    await setTechnicianOnline(supabase, tech.id, {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      effectiveRadiusKm: radiusKm,
      validHours: option.hours,
    });
    await clearStep(ctx);
    await reply(
      ctx,
      `🟢 *You are online* (${option.label.toLowerCase()}).\nTravel radius: ${radiusKm} km.\nNew job offers will appear here.`,
      KeyboardBuilder.technicianMainMenu(true)
    );
    return true;
  }

  if (u.callbackData === 'tech_history') {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const { data: jobs } = await supabase
      .from('service_requests')
      .select('id, request_number, status, completed_at, category:service_categories(name), ratings(score, reviewer_id)')
      .eq('assigned_technician_id', tech.id)
      .in('status', ['COMPLETED', 'PARTIALLY_COMPLETED', 'UNABLE_TO_COMPLETE', 'DISPUTED'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(5);
    const lines = ((jobs ?? []) as any[]).map((j) => {
      const fromCustomer = (j.ratings ?? []).find((r: any) => r.reviewer_id !== profile.id);
      return `• \`${j.request_number}\` ${escapeMd(j.category?.name ?? '')}: \`${j.status}\`${fromCustomer ? ` · ${'⭐'.repeat(fromCustomer.score)}` : ''}`;
    });
    const pct = (v: unknown) => `${Math.round(Number(v) * 100)}%`;
    await reply(
      ctx,
      `📊 *Performance*\n\n` +
        `⭐ Rating: ${tech.completed_request_count > 0 ? `${Number(tech.average_rating).toFixed(1)}/5` : 'new'}\n` +
        `✅ Completed jobs: ${tech.completed_request_count}\n` +
        `👍 Acceptance rate: ${pct(tech.acceptance_rate)}\n` +
        `🏁 Completion rate: ${pct(tech.completion_rate)}\n` +
        `↩️ Cancellation rate: ${pct(tech.post_acceptance_cancellation_rate)}\n\n` +
        `*Recent jobs*\n${lines.join('\n') || '• None yet'}`,
      {
        inline_keyboard: [
          ...((jobs ?? []) as any[]).map((j) => [{ text: `🔎 ${j.request_number}`, callback_data: `req_view:${j.id}` }]),
          [{ text: '⬅️ Back', callback_data: 'cmd_tech_portal' }],
        ],
      }
    );
    return true;
  }

  if (u.callbackData === 'tech_go_offline') {
    const tech = await getTech(ctx);
    if (tech) await setTechnicianOffline(supabase, tech.id);
    await reply(ctx, '🔴 You are now offline. You will not receive new job offers.', KeyboardBuilder.technicianMainMenu(false));
    return true;
  }

  // ---------------------------------------------------------------- offers (spec §6.5)
  const acceptOfferId = cb(ctx, 'offer_accept:');
  if (acceptOfferId) {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const { data: offer } = await supabase
      .from('request_offers')
      .select('service_request_id, distance_km')
      .eq('id', acceptOfferId)
      .eq('technician_id', tech.id)
      .maybeSingle();
    if (!offer) {
      await reply(ctx, 'ℹ️ This offer is no longer available.');
      return true;
    }

    const assignment = await processAtomicAssignment(supabase, offer.service_request_id, tech.id, acceptOfferId);
    if (!assignment.success) {
      await reply(
        ctx,
        assignment.reason === 'OFFER_EXPIRED'
          ? '⌛ This offer has expired.'
          : 'ℹ️ This request was already accepted by another technician or was cancelled.'
      );
      return true;
    }

    await notifyAssignment(supabase, ctx.sender, offer.service_request_id, tech.id, offer.distance_km != null ? Number(offer.distance_km) : null);
    return true;
  }

  const declineOfferId = cb(ctx, 'offer_decline:');
  if (declineOfferId) {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    // Once every offer in a batch is answered, the next cron run sends the next batch.
    await supabase
      .from('request_offers')
      .update({ offer_status: 'DECLINED', responded_at: new Date().toISOString() })
      .eq('id', declineOfferId)
      .eq('technician_id', tech.id)
      .in('offer_status', ['SENT', 'VIEWED']);
    await reply(ctx, '👍 Offer declined.');
    return true;
  }

  // ---------------------------------------------------------------- jobs (spec §6.7, §6.8)
  if (u.callbackData === 'tech_active_jobs') {
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const { data: jobs } = await supabase
      .from('service_requests')
      .select(JOB_SELECT)
      .eq('assigned_technician_id', tech.id)
      .in('status', ACTIVE_JOB_STATUSES)
      .order('assigned_at', { ascending: false });
    if (!jobs?.length) {
      await reply(ctx, 'You have no active jobs right now.');
      return true;
    }
    for (const j of jobs as any[]) {
      await reply(
        ctx,
        `🔨 \`${j.request_number}\` ${escapeMd(j.category?.name ?? '')} - ${escapeMd(j.issue?.name ?? '')}\nStatus: \`${j.status}\`\n📍 ${escapeMd(j.service_address_text ?? '-')}`,
        KeyboardBuilder.technicianJobStatusButtons(j.id, j.status)
      );
    }
    return true;
  }

  const jobCb = cb(ctx, 'job:');
  if (jobCb) {
    const [action, requestId] = jobCb.split(':');
    const tech = await getTech(ctx);
    if (!tech) return notTechnician(ctx);
    const job = await getAssignedJob(ctx, requestId, tech.id);
    if (!job) {
      await reply(ctx, 'This job is not assigned to you.');
      return true;
    }
    const status = job.status as RequestStatus;
    const customerChat = job.customer?.telegram_user_id as number | undefined;
    let newStatus: RequestStatus | null = null;

    // Live job tracking for the customer: every technician step is announced (and visible in 🔎 Track)
    const tellCustomer = (text: string) =>
      customerChat
        ? ctx.sender.sendMessage({
            chatId: customerChat,
            text,
            replyMarkup: { inline_keyboard: [[{ text: '🔎 Track request', callback_data: `req_view:${requestId}` }]] },
          })
        : Promise.resolve(false);

    if (action === 'CONTACTED' && status === 'ASSIGNED') {
      if (await advanceJob(ctx, requestId, status, 'CONTACTED')) {
        newStatus = 'CONTACTED';
        if (customerChat) {
          await ctx.sender.sendMessage({
            chatId: customerChat,
            text: `📞 Your technician says they have contacted you about \`${job.request_number}\`. Agree on the visit charge and scope with them.`,
            replyMarkup: {
              inline_keyboard: [
                [{ text: '🔎 Track request', callback_data: `req_view:${requestId}` }],
                [{ text: "📵 I haven't heard from them", callback_data: `req_nocontact:${requestId}` }],
              ],
            },
          });
        }
      }
    } else if (action === 'AGREE' && (status === 'CONTACTED' || status === 'DISCUSSING_SCOPE')) {
      await setStep(ctx, 'TECH_ESTIMATE', { requestId });
      await reply(
        ctx,
        '🤝 *Record the agreed price* (optional)\n\nSend the amounts as: visit charge, labour, parts\nExample: `200, 800, 0`\n\n_This is a shared record for you and the customer. HomeOps does not collect payment._',
        { inline_keyboard: [[{ text: '⏭ Skip, no price recorded', callback_data: 'est_skip' }]] }
      );
      return true;
    } else if (action === 'START' && status === 'AGREED') {
      // Start PIN: the customer's code proves the technician is actually there (fake-work protection)
      await setStep(ctx, 'TECH_START_PIN', { requestId });
      await reply(ctx, `🔑 *Ask the customer for their 4-digit start code* for \`${job.request_number}\` and type it here.`, {
        inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'tech_active_jobs' }]],
      });
      return true;
    } else if (action === 'DONE' && status === 'IN_PROGRESS') {
      await setStep(ctx, 'TECH_AFTER_PHOTO', { requestId });
      await reply(ctx, '📷 *Send a photo of the finished work.* The customer sees it when they confirm the job.', {
        inline_keyboard: [[{ text: "⏭ Can't take a photo", callback_data: 'after_skip' }]],
      });
      return true;
    } else if (action === 'UNABLE' && (status === 'IN_PROGRESS' || status === 'CONTACTED')) {
      await reply(ctx, `⚠️ *Why can't you complete \`${job.request_number}\`?*`, {
        inline_keyboard: [
          ...Object.values(CANCEL_REASONS.UNABLE).map((label, i) => [{ text: label, callback_data: `ureason:${i}:${requestId}` }]),
          [{ text: '⬅️ Back', callback_data: 'tech_active_jobs' }],
        ],
      });
      return true;
    } else if ((action === 'CANCEL' || action === 'CANCEL_YES') && REOPENABLE_STATUSES.includes(status)) {
      await reply(ctx, `*Why are you cancelling \`${job.request_number}\`?*\n\n_We'll find the customer another technician. Cancellations lower your ranking._`, {
        inline_keyboard: [
          ...Object.values(CANCEL_REASONS.TECHNICIAN).map((label, i) => [{ text: label, callback_data: `jreason:${i}:${requestId}` }]),
          [{ text: 'No, keep the job', callback_data: 'tech_active_jobs' }],
        ],
      });
      return true;
    }

    await reply(
      ctx,
      newStatus
        ? `✅ \`${job.request_number}\` is now \`${newStatus}\`.`
        : `ℹ️ \`${job.request_number}\` is \`${status}\`, so that step isn't available.`,
      KeyboardBuilder.technicianJobStatusButtons(requestId, newStatus ?? status)
    );
    return true;
  }

  // ---------------------------------------------------------------- start PIN
  if (inStep(ctx, 'TECH_START_PIN') && u.text) {
    const requestId = data.requestId as string;
    const tech = await getTech(ctx);
    const job = tech ? await getAssignedJob(ctx, requestId, tech.id) : null;
    if (!job || job.status !== 'AGREED') {
      await clearStep(ctx);
      await reply(ctx, 'This job can no longer be started.');
      return true;
    }
    const { data: pinRow } = await supabase.from('service_requests').select('start_pin, start_pin_attempts').eq('id', requestId).single();
    // Jobs assigned before start PINs existed have no PIN; let them start.
    if (pinRow?.start_pin && u.text.replace(/\D/g, '') !== pinRow.start_pin) {
      const attempts = (pinRow.start_pin_attempts ?? 0) + 1;
      await supabase.from('service_requests').update({ start_pin_attempts: attempts }).eq('id', requestId);
      if (attempts >= SAFETY_CONFIG.MAX_PIN_ATTEMPTS) {
        await clearStep(ctx);
        await raiseFlag(supabase, {
          requestId,
          againstProfileId: profile.id,
          type: 'Start PIN failures',
          details: `${attempts} wrong start-code attempts.`,
          needsReview: true,
        });
        await reply(ctx, '🔒 Too many wrong codes. Our team has been alerted. Please contact Support from the menu.');
      } else {
        await reply(ctx, `❌ That code doesn't match. ${SAFETY_CONFIG.MAX_PIN_ATTEMPTS - attempts} attempts left.`);
      }
      return true;
    }
    await clearStep(ctx);
    if (!(await advanceJob(ctx, requestId, 'AGREED', 'IN_PROGRESS', { work_started_at: new Date().toISOString() }))) {
      await reply(ctx, 'This job can no longer be started.');
      return true;
    }
    if (job.customer?.telegram_user_id) {
      await ctx.sender.sendMessage({
        chatId: job.customer.telegram_user_id,
        text: `🔨 Work has started on \`${job.request_number}\`.`,
        replyMarkup: { inline_keyboard: [[{ text: '🔎 Track request', callback_data: `req_view:${requestId}` }]] },
      });
    }
    await reply(ctx, `✅ Code accepted. \`${job.request_number}\` is now \`IN_PROGRESS\`.`, KeyboardBuilder.technicianJobStatusButtons(requestId, 'IN_PROGRESS'));
    return true;
  }

  // ---------------------------------------------------------------- after photo → work complete
  if (inStep(ctx, 'TECH_AFTER_PHOTO') && (u.photoFileId || u.otherMedia || u.callbackData === 'after_skip')) {
    if (u.otherMedia && !u.photoFileId) {
      await reply(ctx, 'Please send a photo (not a file or video), or tap "Can\'t take a photo".');
      return true;
    }
    const requestId = data.requestId as string;
    await clearStep(ctx);
    const tech = await getTech(ctx);
    const job = tech ? await getAssignedJob(ctx, requestId, tech.id) : null;
    if (!job || job.status !== 'IN_PROGRESS') {
      await reply(ctx, 'This job can no longer be marked complete.');
      return true;
    }
    if (u.photoFileId) {
      await supabase.from('attachments').insert({
        service_request_id: requestId,
        uploaded_by: profile.id,
        telegram_file_id: u.photoFileId,
        telegram_file_unique_id: u.photoFileUniqueId ?? null,
        file_size_bytes: u.photoFileSize ?? null,
        mime_type: 'image/jpeg',
        attachment_type: 'AFTER_PHOTO',
        expires_at: new Date(Date.now() + 90 * 24 * 3600_000).toISOString(),
      });
    }
    if (!(await markTechnicianComplete(supabase, requestId, profile.id))) {
      await reply(ctx, 'Could not mark the job complete. Please try again.');
      return true;
    }

    // Too-fast completion is a fake-work signal: flag it and tell the customer how long it took
    const { data: timing } = await supabase.from('service_requests').select('work_started_at').eq('id', requestId).single();
    const minutes = timing?.work_started_at ? Math.round((Date.now() - new Date(timing.work_started_at).getTime()) / 60000) : null;
    const tooFast = minutes !== null && minutes < SAFETY_CONFIG.MIN_WORK_MINUTES;
    if (tooFast) {
      await raiseFlag(supabase, {
        requestId,
        againstProfileId: profile.id,
        type: 'Very fast completion',
        details: `Marked complete ${minutes} min after work started.`,
        needsReview: true,
      });
    }

    const customerChat = job.customer?.telegram_user_id as number | undefined;
    if (customerChat) {
      if (u.photoFileId) await ctx.sender.sendPhoto(customerChat, u.photoFileId, `📷 Finished work for ${job.request_number}`);
      const notes = [
        minutes !== null ? `⏱ Marked complete ${minutes} min after work started.` : null,
        u.photoFileId ? null : '📷 No photo of the finished work was provided.',
      ].filter(Boolean) as string[];
      await CustomerNotifications.notifyWorkMarkedComplete(ctx.sender, customerChat, requestId, job.request_number, notes);
    }
    await reply(ctx, `✅ \`${job.request_number}\` sent to the customer for confirmation.`);
    await reply(ctx, '💵 *Did the customer pay you directly?*', KeyboardBuilder.paymentButtons(requestId, false));
    // The technician's review is asked now (the customer may never confirm); it only counts once the job is confirmed.
    const { data: cust } = await supabase
      .from('service_requests')
      .select('customer:profiles!service_requests_customer_id_fkey(full_name)')
      .eq('id', requestId)
      .single();
    await promptRating(ctx, requestId, (cust as any)?.customer?.full_name ?? null, false);
    return true;
  }

  // ---------------------------------------------------------------- unable to complete (with reason)
  const unable = cb(ctx, 'ureason:');
  if (unable) {
    const [idx, requestId] = unable.split(':');
    const [code, label] = Object.entries(CANCEL_REASONS.UNABLE)[parseInt(idx, 10)] ?? ['OTHER', 'Other'];
    const tech = await getTech(ctx);
    const job = tech ? await getAssignedJob(ctx, requestId, tech.id) : null;
    const status = job?.status as RequestStatus | undefined;
    if (!job || (status !== 'IN_PROGRESS' && status !== 'CONTACTED')) {
      await reply(ctx, 'This job can no longer be marked as unable to complete.');
      return true;
    }
    if (!(await advanceJob(ctx, requestId, status, 'UNABLE_TO_COMPLETE', { closure_reason: code }))) {
      await reply(ctx, 'This job can no longer be marked as unable to complete.');
      return true;
    }
    await closeRelay(supabase, requestId);
    await supabase.rpc('update_technician_metrics', { p_technician_id: tech.id });
    const customerChat = job.customer?.telegram_user_id as number | undefined;
    if (customerChat) {
      await ctx.sender.sendMessage({
        chatId: customerChat,
        text: `⚠️ The technician couldn't complete \`${job.request_number}\` (${label}). If this isn't right, please report it.`,
        replyMarkup: {
          inline_keyboard: [
            [{ text: '🔍 Find another technician', callback_data: 'cmd_new_request' }],
            [{ text: '⚠️ Report a problem', callback_data: `prob:${requestId}` }],
          ],
        },
      });
    }
    // "Customer not available" counts against the customer, not the technician (see migration 00012)
    if (code === 'CUSTOMER_NOT_AVAILABLE') {
      const { data: owner } = await supabase.from('service_requests').select('customer_id').eq('id', requestId).single();
      if (owner && (await customerReliabilityStrikes(supabase, owner.customer_id)) >= LIMITS_CONFIG.LATE_CANCEL_FLAG_COUNT) {
        await raiseFlag(supabase, {
          requestId,
          againstProfileId: owner.customer_id,
          type: 'Repeated late cancellations',
          details: 'Repeated late cancellations or no-shows in the last 30 days (latest: technician reported customer not available).',
        });
      }
    }
    await reply(ctx, `Noted. \`${job.request_number}\` is closed as unable to complete.`, KeyboardBuilder.technicianMainMenu(await isOnline(ctx, tech.id)));
    return true;
  }

  // ---------------------------------------------------------------- technician cancellation (with reason)
  const jreason = cb(ctx, 'jreason:');
  if (jreason) {
    const [idx, requestId] = jreason.split(':');
    const [code, label] = Object.entries(CANCEL_REASONS.TECHNICIAN)[parseInt(idx, 10)] ?? ['OTHER', 'Other'];
    const tech = await getTech(ctx);
    const job = tech ? await getAssignedJob(ctx, requestId, tech.id) : null;
    if (!job) {
      await reply(ctx, 'This job is not assigned to you.');
      return true;
    }
    const result = await cancelServiceRequest(supabase, requestId, profile.id, 'TECHNICIAN', label, code);
    if (!result.success) {
      await reply(ctx, `\`${job.request_number}\` can't be cancelled now. If work has started, use "Unable to Complete".`);
      return true;
    }
    await supabase.rpc('update_technician_metrics', { p_technician_id: tech.id });
    await reply(ctx, `✅ \`${job.request_number}\` cancelled.`, KeyboardBuilder.technicianMainMenu(await isOnline(ctx, tech.id)));
    await startRematch(supabase, ctx.sender, job, result.rematch ?? 'NOW', job.customer?.telegram_user_id, `Your technician had to cancel (${label}).`);

    if ((await technicianCancelsThisWeek(supabase, profile.id)) >= LIMITS_CONFIG.TECH_CANCEL_FLAG_COUNT) {
      await raiseFlag(supabase, {
        requestId,
        againstProfileId: profile.id,
        type: 'Frequent cancellations',
        details: `${LIMITS_CONFIG.TECH_CANCEL_FLAG_COUNT}+ cancelled jobs in the last 7 days (latest reason: ${label}).`,
      });
      await reply(ctx, '⚠️ You have cancelled several jobs this week. Frequent cancellations reduce the offers you receive and are reviewed by our team.');
    }
    return true;
  }

  if (inStep(ctx, 'TECH_ESTIMATE') && (u.text || u.callbackData === 'est_skip')) {
    const amounts = u.text ? parseEstimate(u.text) : null;
    if (u.text && !amounts) {
      await reply(ctx, 'Please send up to three numbers, e.g. `200, 800, 0`, or tap Skip.', {
        inline_keyboard: [[{ text: '⏭ Skip, no price recorded', callback_data: 'est_skip' }]],
      });
      return true;
    }
    const requestId = data.requestId as string;
    await clearStep(ctx);
    const tech = await getTech(ctx);
    const job = tech ? await getAssignedJob(ctx, requestId, tech.id) : null;
    const status = job?.status as RequestStatus | undefined;
    if (!job || (status !== 'CONTACTED' && status !== 'DISCUSSING_SCOPE') || !(await advanceJob(ctx, requestId, status, 'AGREED'))) {
      await reply(ctx, 'This job can no longer be marked as agreed.');
      return true;
    }

    const customerChat = job.customer?.telegram_user_id as number | undefined;
    if (amounts) {
      await recordEstimate(supabase, { serviceRequestId: requestId, recordedByProfileId: profile.id, ...amounts });
      const total = amounts.visitCharge + amounts.labourAmount + amounts.partsAmount;
      if (customerChat) {
        await ctx.sender.sendMessage({
          chatId: customerChat,
          text:
            `🤝 *Agreed estimate for \`${job.request_number}\`*\n\n` +
            `Visit charge: ₹${amounts.visitCharge}\nLabour: ₹${amounts.labourAmount}\nParts: ₹${amounts.partsAmount}\n*Total: ₹${total}*\n\n` +
            `_Recorded by the technician. Pay the technician directly; HomeOps does not collect payment._`,
          replyMarkup: {
            inline_keyboard: [
              [{ text: '👍 Matches what we agreed', callback_data: `est_ack:${requestId}` }],
              [{ text: "⚠️ That's not what we agreed", callback_data: `est_dispute:${requestId}` }],
            ],
          },
        });
      }
    } else if (customerChat) {
      await ctx.sender.sendMessage({ chatId: customerChat, text: `🤝 The technician marked scope and price for \`${job.request_number}\` as agreed with you.` });
    }
    await reply(ctx, `✅ \`${job.request_number}\` is now \`AGREED\`.`, KeyboardBuilder.technicianJobStatusButtons(requestId, 'AGREED'));
    return true;
  }

  return false;
}

// ------------------------------------------------------------------ helpers

async function getTech(ctx: BotContext): Promise<any | null> {
  const { data } = await ctx.supabase.from('technician_profiles').select('*').eq('profile_id', ctx.profile.id).maybeSingle();
  return data;
}

async function isOnline(ctx: BotContext, technicianId: string): Promise<boolean> {
  const { data } = await ctx.supabase
    .from('technician_availability')
    .select('id')
    .eq('technician_id', technicianId)
    .eq('availability_status', 'ONLINE')
    .gt('location_expires_at', new Date().toISOString())
    .limit(1);
  return !!data?.length;
}

async function getAssignedJob(ctx: BotContext, requestId: string, technicianId: string): Promise<any | null> {
  const { data } = await ctx.supabase
    .from('service_requests')
    .select(JOB_SELECT)
    .eq('id', requestId)
    .eq('assigned_technician_id', technicianId) // only the assigned technician can move the job (spec §6.8)
    .maybeSingle();
  return data;
}

/** Guarded single-step transition with its audit event; false if the job was no longer in `from`. */
async function advanceJob(
  ctx: BotContext,
  requestId: string,
  from: RequestStatus,
  to: RequestStatus,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from('service_requests')
    .update({ status: to, ...extra })
    .eq('id', requestId)
    .eq('status', from)
    .select('id');
  if (error || !data?.length) return false;
  await logRequestEvent(ctx.supabase, {
    serviceRequestId: requestId,
    eventType: to,
    oldStatus: from,
    newStatus: to,
    performedBy: ctx.profile.id,
    notes: 'Updated by technician via bot',
  });
  return true;
}


function profileButtons() {
  return {
    inline_keyboard: [
      [{ text: '📍 Update base location', callback_data: 'tech_edit_loc' }],
      [{ text: '📏 Change travel radius', callback_data: 'tech_edit_radius' }],
      [{ text: '➕ Add skills', callback_data: 'tech_edit_skills' }],
      [{ text: '🪪 Upload ID document', callback_data: 'tech_upload_id' }],
      [{ text: '🔒 Contact privacy', callback_data: 'cmd_privacy' }],
      [{ text: '⬅️ Back', callback_data: 'cmd_tech_portal' }],
    ],
  };
}

async function notTechnician(ctx: BotContext): Promise<boolean> {
  await reply(ctx, 'You are not registered as a technician. Use /technician to apply.');
  return true;
}

/** Category toggle list. Re-renders in place when the user taps a category. */
async function sendSkillPicker(ctx: BotContext, selected: string[], excludeIds: string[], intro?: string): Promise<void> {
  const { data: categories } = await ctx.supabase
    .from('service_categories')
    .select('id, name')
    .eq('active', true)
    .order('display_order', { ascending: true });

  const available = (categories ?? []).filter((c) => !excludeIds.includes(c.id));
  if (!available.length) {
    await clearStep(ctx);
    await reply(ctx, 'You already have every service category.', profileButtons());
    return;
  }

  const keyboard = {
    inline_keyboard: [
      ...available.map((c) => [{ text: `${selected.includes(c.id) ? '✅' : '⬜'} ${c.name}`, callback_data: `tech_skill:${c.id}` }]),
      [{ text: `➡️ Done (${selected.length} selected)`, callback_data: 'tech_skill_done' }],
    ],
  };

  if (!intro && ctx.u.messageId) {
    await ctx.sender.editReplyMarkup(ctx.u.chatId, ctx.u.messageId, keyboard);
  } else {
    await reply(ctx, intro ?? 'Select services:', keyboard);
  }
}

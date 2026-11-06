import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from './message-sender';
import { KeyboardBuilder } from './keyboard-builder';
import { parseTelegramUpdate } from './message-parser';
import { TelegramUpdate } from '../types/telegram';
import { getOrCreateCustomerProfile } from '../customers/customer-registration';
import { createServiceRequest } from '../customers/customer-requests';
import { setTechnicianOnline, setTechnicianOffline } from '../technicians/availability';
import { evaluateEligibility } from '../matching/eligibility-filter';
import { rankCandidate, sortCandidatesWithFairRotation } from '../matching/ranking';
import { dispatchOfferBatch } from '../matching/offer-batches';
import { processAtomicAssignment } from '../matching/assignment';
import { CustomerNotifications } from '../notifications/customer-notifications';
import { TechnicianNotifications } from '../notifications/technician-notifications';
import { submitRating } from '../trust/ratings';
import { getUserSession, setUserSession, clearUserSession } from '../services/session-store';
import { CandidateTechnician, ScoredCandidate } from '../types/matching';
import { UrgencyLevel } from '../types/database';
import { BOT_TEXTS } from '../config/constants';

export async function handleTelegramWebhook(
  update: TelegramUpdate,
  supabase: SupabaseClient,
  botToken: string
): Promise<Response> {
  const messageSender = new MessageSender(botToken);
  const parsed = parseTelegramUpdate(update);

  if (!parsed) {
    return new Response('OK', { status: 200 });
  }

  // Idempotency: verify update hasn't already been processed (Spec v1.1 Section 7.15)
  const { error: idempotencyErr } = await supabase
    .from('processed_telegram_updates')
    .insert({
      update_id: update.update_id,
      processing_result: 'SUCCESS',
    });

  if (idempotencyErr) {
    // 23505 = unique_violation: Telegram re-delivered an update we already handled.
    if (idempotencyErr.code === '23505') {
      return new Response('OK', { status: 200 });
    }
    // Anything else (bad Supabase key, missing tables, network) is a real failure.
    // Log it and return 500 so it shows in `wrangler tail` and Telegram's getWebhookInfo
    // instead of the bot going silent.
    console.error('Supabase error recording Telegram update:', idempotencyErr);
    return new Response('Database unavailable', { status: 500 });
  }

  const { userId, chatId, firstName, username, text, isCallback, callbackData, callbackQueryId, location } = parsed;

  if (isCallback && callbackQueryId) {
    await messageSender.answerCallbackQuery({ callbackQueryId });
  }

  // Load/create profile with username
  const profile = await getOrCreateCustomerProfile(supabase, userId, firstName, username);
  if (!profile || profile.account_status === 'SUSPENDED') {
    await messageSender.sendMessage({
      chatId,
      text: '⚠️ Your account is suspended or inaccessible. Please contact support.',
    });
    return new Response('OK', { status: 200 });
  }

  const session = await getUserSession(userId, supabase);

  // --------------------------------------------------------------------------
  // Bot-Mediated Relay Fallback Check (Spec v1.1 Section 18.2)
  // If user sends normal text and is in an active assignment conversation
  // --------------------------------------------------------------------------
  if (text && !text.startsWith('/') && !session?.step && !isCallback) {
    const { data: activeRelay } = await supabase
      .from('assignment_conversations')
      .select('*, customer:profiles!customer_id(telegram_user_id, full_name), technician:profiles!technician_id(telegram_user_id, full_name)')
      .or(`customer_id.eq.${profile.id},technician_id.eq.${profile.id}`)
      .eq('relay_status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeRelay) {
      const isCustomer = activeRelay.customer_id === profile.id;
      const recipientChatId = isCustomer
        ? (activeRelay.technician as any)?.telegram_user_id
        : (activeRelay.customer as any)?.telegram_user_id;
      const senderRole = isCustomer ? 'Customer' : 'Technician';

      if (recipientChatId) {
        await messageSender.sendMessage({
          chatId: recipientChatId,
          text: `💬 *Message from ${senderRole} (${profile.full_name}):*\n\n${text}`,
        });

        await messageSender.sendMessage({
          chatId,
          text: `✅ _Message forwarded to ${isCustomer ? 'technician' : 'customer'}._`,
        });
        return new Response('OK', { status: 200 });
      }
    }
  }

  // 1. Handle Commands
  if (text === '/start') {
    await clearUserSession(userId);
    await messageSender.sendMessage({
      chatId,
      text: BOT_TEXTS.WELCOME_CUSTOMER,
      replyMarkup: KeyboardBuilder.customerMainMenu(),
    });
    return new Response('OK', { status: 200 });
  }

  if (text === '/technician' || callbackData === 'cmd_tech_portal') {
    await clearUserSession(userId);
    // Check if user has an approved technician profile
    const { data: techProfile } = await supabase
      .from('technician_profiles')
      .select('*')
      .eq('profile_id', profile.id)
      .maybeSingle();

    if (!techProfile) {
      await messageSender.sendMessage({
        chatId,
        text: `${BOT_TEXTS.WELCOME_TECHNICIAN}\n\nWould you like to register as a service technician?`,
        replyMarkup: {
          inline_keyboard: [[{ text: '📝 Submit Technician Application', callback_data: 'tech_apply_start' }]],
        },
      });
      return new Response('OK', { status: 200 });
    }

    const { data: activeLoc } = await supabase
      .from('technician_availability')
      .select('availability_status')
      .eq('technician_id', techProfile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const isOnline = activeLoc?.availability_status === 'ONLINE';

    await messageSender.sendMessage({
      chatId,
      text: `🔧 *Technician Mode*\nStatus: ${isOnline ? '🟢 Online' : '🔴 Offline'}\nVerification: ${techProfile.verification_status}`,
      replyMarkup: KeyboardBuilder.technicianMainMenu(isOnline),
    });
    return new Response('OK', { status: 200 });
  }

  if (callbackData === 'cmd_customer_portal') {
    await messageSender.sendMessage({
      chatId,
      text: BOT_TEXTS.WELCOME_CUSTOMER,
      replyMarkup: KeyboardBuilder.customerMainMenu(),
    });
    return new Response('OK', { status: 200 });
  }

  // 2. Handle Technician Go Online / Offline
  if (callbackData === 'tech_go_online') {
    await setUserSession(userId, 'TECH_ONLINE_LOCATION', {});
    await messageSender.sendMessage({
      chatId,
      text: '📍 Please share your current location to start receiving nearby jobs today:',
      replyMarkup: KeyboardBuilder.requestLocationKeyboard('📍 Share Work Location'),
    });
    return new Response('OK', { status: 200 });
  }

  if (callbackData === 'tech_go_offline') {
    const { data: techProfile } = await supabase
      .from('technician_profiles')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle();

    if (techProfile) {
      await setTechnicianOffline(supabase, techProfile.id);
      await messageSender.sendMessage({
        chatId,
        text: '🔴 You are now offline. You will not receive new job offers.',
        replyMarkup: KeyboardBuilder.technicianMainMenu(false),
      });
    }
    return new Response('OK', { status: 200 });
  }

  // 3. Handle Location input for Technician Going Online
  if (session?.step === 'TECH_ONLINE_LOCATION' && location) {
    const { data: techProfile } = await supabase
      .from('technician_profiles')
      .select('id, default_radius_km')
      .eq('profile_id', profile.id)
      .maybeSingle();

    if (techProfile) {
      await setTechnicianOnline(supabase, techProfile.id, {
        latitude: location.latitude,
        longitude: location.longitude,
        effectiveRadiusKm: techProfile.default_radius_km || 8.0,
      });

      await clearUserSession(userId);
      await messageSender.sendMessage({
        chatId,
        text: `🟢 *You are now Online!*\nRadius: ${techProfile.default_radius_km || 8.0} km.\nMatching offers will be sent to you here.`,
        replyMarkup: KeyboardBuilder.technicianMainMenu(true),
      });
    }
    return new Response('OK', { status: 200 });
  }

  // 4. Handle Customer New Request Flow
  if (callbackData === 'cmd_new_request') {
    const { data: categories } = await supabase
      .from('service_categories')
      .select('*')
      .eq('active', true)
      .order('display_order', { ascending: true });

    const buttons = (categories || []).map((cat) => [
      { text: cat.name, callback_data: `cat_select:${cat.id}:${cat.name}` },
    ]);

    await messageSender.sendMessage({
      chatId,
      text: '🛠 *Select the service category you need:*',
      replyMarkup: { inline_keyboard: buttons },
    });
    return new Response('OK', { status: 200 });
  }

  if (callbackData?.startsWith('cat_select:')) {
    const [, catId, catName] = callbackData.split(':');
    const { data: issues } = await supabase
      .from('issue_types')
      .select('*')
      .eq('service_category_id', catId)
      .eq('active', true);

    const buttons = (issues || []).map((iss) => [
      { text: iss.name, callback_data: `iss_select:${catId}:${iss.id}:${iss.name}` },
    ]);

    await messageSender.sendMessage({
      chatId,
      text: `🔧 *${catName}*\nSelect specific issue:`,
      replyMarkup: { inline_keyboard: buttons },
    });
    return new Response('OK', { status: 200 });
  }

  if (callbackData?.startsWith('iss_select:')) {
    const [, catId, issId, issName] = callbackData.split(':');

    // Check for safety message
    const { data: issueRecord } = await supabase
      .from('issue_types')
      .select('safety_message, urgency_level')
      .eq('id', issId)
      .single();

    if (issueRecord?.safety_message) {
      await messageSender.sendMessage({
        chatId,
        text: `${BOT_TEXTS.SAFETY_HEADER}\n\n${issueRecord.safety_message}`,
      });
    }

    await setUserSession(userId, 'CUST_LOCATION', {
      serviceCategoryId: catId,
      issueTypeId: issId,
      issueName: issName,
      urgency: issueRecord?.urgency_level || 'NORMAL',
    });

    await messageSender.sendMessage({
      chatId,
      text: '📍 Please share the location where the service is required:',
      replyMarkup: KeyboardBuilder.requestLocationKeyboard('📍 Share Service Location'),
    });
    return new Response('OK', { status: 200 });
  }

  // 5. Handle Customer Service Location Submission & Trigger Matching
  if (session?.step === 'CUST_LOCATION' && location) {
    const req = await createServiceRequest(supabase, {
      customerId: profile.id,
      serviceCategoryId: session.data.serviceCategoryId as string,
      issueTypeId: session.data.issueTypeId as string,
      description: `${session.data.issueName as string} service requested`,
      serviceAddressText: `Lat: ${location.latitude.toFixed(4)}, Lon: ${location.longitude.toFixed(4)}`,
      serviceLatitude: location.latitude,
      serviceLongitude: location.longitude,
      urgency: (session.data.urgency as UrgencyLevel) || 'NORMAL',
    });

    await clearUserSession(userId);

    if (!req) {
      await messageSender.sendMessage({
        chatId,
        text: '❌ Could not create service request. Please try again.',
      });
      return new Response('OK', { status: 200 });
    }

    await messageSender.sendMessage({
      chatId,
      text: `🔎 *Searching for suitable nearby technicians...*\nRequest ID: \`${req.request_number}\`\n\nWe will notify you as soon as a verified technician accepts.`,
    });

    // Execute Matching Engine Query
    const { data: activeTechs } = await supabase
      .from('technician_availability')
      .select(`
        technician_id,
        current_latitude,
        current_longitude,
        effective_radius_km,
        location_expires_at,
        technician_profiles!inner (
          id,
          profile_id,
          verification_status,
          average_rating,
          completed_request_count,
          acceptance_rate,
          completion_rate,
          post_acceptance_cancellation_rate,
          complaint_rate,
          probation_status,
          last_offered_at,
          recent_offer_count_7d,
          recent_assignment_count_30d,
          created_at,
          profiles!inner (
            telegram_user_id,
            full_name,
            phone_number,
            account_status
          )
        )
      `)
      .eq('availability_status', 'ONLINE');

    const candidates: ScoredCandidate[] = [];

    for (const tech of activeTechs || []) {
      const tp = (tech as any).technician_profiles;
      const p = tp.profiles;

      // Check skill
      const { data: skill } = await supabase
        .from('technician_skills')
        .select('id')
        .eq('technician_id', tech.technician_id)
        .eq('service_category_id', req.service_category_id)
        .eq('approval_status', 'APPROVED')
        .maybeSingle();

      const candidate: CandidateTechnician = {
        technician_id: tech.technician_id,
        profile_id: tp.profile_id,
        telegram_user_id: p.telegram_user_id,
        full_name: p.full_name,
        phone_number: p.phone_number,
        account_status: p.account_status,
        verification_status: tp.verification_status,
        current_latitude: tech.current_latitude,
        current_longitude: tech.current_longitude,
        effective_radius_km: tech.effective_radius_km,
        location_expires_at: tech.location_expires_at,
        active_assignments_count: 0,
        average_rating: tp.average_rating,
        completed_request_count: tp.completed_request_count,
        acceptance_rate: tp.acceptance_rate,
        completion_rate: tp.completion_rate,
        post_acceptance_cancellation_rate: tp.post_acceptance_cancellation_rate,
        complaint_rate: tp.complaint_rate,
        probation_status: tp.probation_status,
        last_offered_at: tp.last_offered_at,
        recent_offer_count_7d: tp.recent_offer_count_7d || 0,
        recent_assignment_count_30d: tp.recent_assignment_count_30d || 0,
        created_at: tp.created_at,
        has_exact_skill: !!skill,
        has_category_skill: !!skill,
      };

      const eligibility = evaluateEligibility(candidate, req.service_latitude, req.service_longitude);
      if (eligibility.eligible) {
        const scored = rankCandidate(candidate, eligibility.distance_km);
        candidates.push(scored);
      }
    }

    const sortedCandidates = sortCandidatesWithFairRotation(candidates, req.urgency as UrgencyLevel);

    if (sortedCandidates.length === 0) {
      await CustomerNotifications.notifyNoTechnicianFound(messageSender, chatId);
    } else {
      await dispatchOfferBatch(supabase, messageSender, req.id, 1, sortedCandidates, {
        categoryName: 'Home Service',
        issueName: session.data.issueName as string,
        serviceArea: req.service_address_text || 'Customer Locality',
        hasPhoto: false,
      });
    }

    return new Response('OK', { status: 200 });
  }

  // 6. Handle Technician Accepting Offer
  if (callbackData?.startsWith('offer_accept:')) {
    const [, requestId, offerId] = callbackData.split(':');

    const { data: techProfile } = await supabase
      .from('technician_profiles')
      .select('id, profile_id, profiles(full_name, phone_number, telegram_username, telegram_user_id)')
      .eq('profile_id', profile.id)
      .single();

    if (!techProfile) return new Response('OK', { status: 200 });

    const assignment = await processAtomicAssignment(supabase, requestId, techProfile.id, offerId);

    if (!assignment.success) {
      await messageSender.sendMessage({
        chatId,
        text: 'ℹ️ This request has already been accepted by another technician or was cancelled.',
      });
      return new Response('OK', { status: 200 });
    }

    // Reveal exact customer location to assigned technician
    const { data: customerReq } = await supabase
      .from('service_requests')
      .select('*, customer:profiles(telegram_user_id, full_name, phone_number, telegram_username)')
      .eq('id', requestId)
      .single();

    if (customerReq) {
      const cust = customerReq.customer as any;
      await TechnicianNotifications.notifyAssignmentWon(messageSender, chatId, {
        requestId,
        requestNumber: customerReq.request_number,
        customerName: cust.full_name,
        customerPhone: cust.phone_number,
        customerUsername: cust.telegram_username,
        customerTelegramUserId: cust.telegram_user_id,
        serviceAddress: customerReq.service_address_text,
        serviceLat: customerReq.service_latitude,
        serviceLon: customerReq.service_longitude,
        description: customerReq.description,
      });

      // Notify customer that technician has been connected with contact fallback
      const techP = techProfile.profiles as any;
      await CustomerNotifications.notifyTechnicianMatched(messageSender, cust.telegram_user_id, {
        fullName: techP?.full_name || 'Verified Technician',
        categoryName: 'Service',
        rating: 4.8,
        completedJobs: 12,
        phoneNumber: techP?.phone_number,
        telegramUsername: techP?.telegram_username,
        telegramUserId: techP?.telegram_user_id,
        distanceKm: 3.5,
      });
    }

    return new Response('OK', { status: 200 });
  }

  // 7. Handle Rating
  if (callbackData?.startsWith('rate:')) {
    const [, scoreStr, reqId] = callbackData.split(':');
    const score = parseInt(scoreStr, 10);

    const { data: req } = await supabase
      .from('service_requests')
      .select('assigned_technician_id, technician:technician_profiles(profile_id)')
      .eq('id', reqId)
      .single();

    if (req && (req as any).technician) {
      await submitRating(supabase, {
        serviceRequestId: reqId,
        reviewerProfileId: profile.id,
        reviewedProfileId: (req as any).technician.profile_id,
        score,
      });

      await messageSender.sendMessage({
        chatId,
        text: `⭐ Thank you for rating ${score}/5! Your feedback helps keep HomeOps safe and reliable.`,
      });
    }

    return new Response('OK', { status: 200 });
  }

  // Default fallback reply
  await messageSender.sendMessage({
    chatId,
    text: 'Use the buttons below to navigate:',
    replyMarkup: KeyboardBuilder.customerMainMenu(),
  });

  return new Response('OK', { status: 200 });
}

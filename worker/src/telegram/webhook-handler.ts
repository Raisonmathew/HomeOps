import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from './message-sender';
import { KeyboardBuilder } from './keyboard-builder';
import { parseTelegramUpdate } from './message-parser';
import { TelegramUpdate } from '../types/telegram';
import { getOrCreateCustomerProfile } from '../customers/customer-registration';
import { getUserSession } from '../services/session-store';
import { BotContext, reply } from './context';
import { handleCustomer } from './customer-flow';
import { handleTechnician } from './technician-flow';
import { escapeMd } from './format';
import { handleShared, remindPendingReview } from './shared-flow';
import { BOT_TEXTS, PRIVACY_TERMS_VERSION, TERMS_TEXT } from '../config/constants';

const OK = () => new Response('OK', { status: 200 });

export async function handleTelegramWebhook(
  update: TelegramUpdate,
  supabase: SupabaseClient,
  botToken: string,
  config: BotContext['config'] = {}
): Promise<Response> {
  const sender = new MessageSender(botToken);
  const u = parseTelegramUpdate(update);

  // The bot only talks to people one-to-one. Group messages (e.g. the operator Support group) are
  // ignored, and the chat ID is logged so it can be copied into SUPPORT_CHAT_ID.
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  if (chat && chat.type !== 'private') {
    console.log(`Update ${update.update_id}: ignored ${chat.type} chat ${chat.id}`);
    return OK();
  }

  if (!u) {
    // e.g. my_chat_member (user started/blocked the bot), edited_message, channel posts
    const kind = Object.keys(update).filter((k) => k !== 'update_id').join(',') || 'unknown';
    console.log(`Update ${update.update_id}: ignored (type: ${kind})`);
    return OK();
  }
  // Free text can contain addresses or phone numbers, so only commands/callbacks are logged (spec §11.15).
  const what = u.isCallback
    ? `callback "${u.callbackData}"`
    : u.text?.startsWith('/')
      ? `command "${u.text}"`
      : u.location
        ? 'location'
        : u.contact
          ? 'contact'
          : 'text';
  console.log(`Update ${update.update_id}: ${what} from user ${u.userId}`);

  // Idempotency (spec §7.15)
  const { error: idempotencyErr } = await supabase
    .from('processed_telegram_updates')
    .insert({ update_id: update.update_id, processing_result: 'SUCCESS' });
  if (idempotencyErr) {
    // 23505 = unique_violation: Telegram re-delivered an update we already handled.
    if (idempotencyErr.code === '23505') {
      console.log(`Update ${update.update_id}: duplicate delivery, already processed`);
      return OK();
    }
    // A real failure (bad key, missing table, network): surface it instead of going silent.
    console.error('Supabase error recording Telegram update:', idempotencyErr);
    return new Response('Database unavailable', { status: 500 });
  }

  if (u.isCallback && u.callbackQueryId) {
    await sender.answerCallbackQuery({ callbackQueryId: u.callbackQueryId });
  }

  const profile = await getOrCreateCustomerProfile(supabase, u.userId, u.firstName, u.username);
  if (!profile || profile.account_status === 'SUSPENDED') {
    await sender.sendMessage({ chatId: u.chatId, text: '⚠️ Your account is suspended or inaccessible. Please contact support.' });
    return OK();
  }

  const ctx: BotContext = { supabase, sender, profile, session: await getUserSession(u.userId, supabase), u, config };

  // Terms & privacy must be accepted (once per version) before anything else (spec §6.1)
  if (profile.accepted_terms_version !== PRIVACY_TERMS_VERSION) {
    if (u.callbackData === 'terms_accept') {
      await supabase
        .from('profiles')
        .update({ accepted_terms_version: PRIVACY_TERMS_VERSION, accepted_terms_at: new Date().toISOString() })
        .eq('id', profile.id);
      await reply(ctx, BOT_TEXTS.WELCOME_CUSTOMER, KeyboardBuilder.customerMainMenu());
    } else {
      await reply(ctx, `${TERMS_TEXT}\n\nTap *I agree* to continue.`, { inline_keyboard: [[{ text: '✅ I agree', callback_data: 'terms_accept' }]] });
    }
    return OK();
  }

  // Buttons on messages sent before the callback formats changed keep working
  const legacy = u.callbackData?.match(/^job_status:(CONTACTED|IN_PROGRESS|TECH_COMPLETE|UNABLE):(.+)$/);
  if (legacy) {
    u.callbackData = `job:${{ CONTACTED: 'CONTACTED', IN_PROGRESS: 'START', TECH_COMPLETE: 'DONE', UNABLE: 'UNABLE' }[legacy[1]]}:${legacy[2]}`;
  }
  u.callbackData = u.callbackData?.replace(/^(offer_accept|offer_decline):[0-9a-f-]{36}:([0-9a-f-]{36})$/, '$1:$2');

  if (await relayMessage(ctx)) return OK();

  // "Next time they use the app": opening the bot or a main menu surfaces any unconfirmed/unreviewed job.
  const opensBot = ['/start', '/technician'].includes(u.text ?? '') || ['cmd_customer_portal', 'cmd_tech_portal'].includes(u.callbackData ?? '');
  if (opensBot) await remindPendingReview(ctx);

  if (await handleShared(ctx)) return OK();
  if (await handleCustomer(ctx)) return OK();
  if (await handleTechnician(ctx)) return OK();

  if (ctx.session?.step) {
    // Mid-flow input that didn't match the expected step (e.g. typed text instead of tapping a button)
    await reply(ctx, 'Please complete the current step using the button in the previous message, or send /start to cancel.');
    return OK();
  }

  await reply(ctx, 'Use the buttons below to navigate:', KeyboardBuilder.customerMainMenu());
  return OK();
}

/**
 * Bot-mediated relay (spec §18.2): plain text from a party in an active assignment
 * is forwarded to the other party. Returns true if the message was relayed.
 */
async function relayMessage(ctx: BotContext): Promise<boolean> {
  const { u, profile, supabase } = ctx;
  if (!u.text || u.text.startsWith('/') || u.isCallback || ctx.session?.step) return false;

  const { data: relay } = await supabase
    .from('assignment_conversations')
    .select(
      'customer_id, technician_id, service_request_id, service_request:service_requests(request_number), ' +
        'customer:profiles!customer_id(telegram_user_id), technician:profiles!technician_id(telegram_user_id)'
    )
    .or(`customer_id.eq.${profile.id},technician_id.eq.${profile.id}`)
    .eq('relay_status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!relay) return false;

  const r = relay as any;
  const isCustomer = r.customer_id === profile.id;
  const recipientChatId = isCustomer ? r.technician?.telegram_user_id : r.customer?.telegram_user_id;
  if (!recipientChatId) return false;

  const delivered = await ctx.sender.sendMessage({
    chatId: recipientChatId,
    text: `💬 *${isCustomer ? 'Customer' : 'Technician'} (${escapeMd(profile.full_name)}) about \`${r.service_request?.request_number ?? ''}\`:*\n\n${escapeMd(u.text)}`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '🚫 Block', callback_data: `relay_block:${r.service_request_id}` },
          { text: '🚩 Report', callback_data: `rep:${r.service_request_id}` },
        ],
      ],
    },
  });
  // Kept as evidence for harassment reports (operators only; deleted after RETENTION.RELAY_DAYS, disclosed in Terms)
  await supabase.from('relay_messages').insert({
    service_request_id: r.service_request_id,
    sender_profile_id: profile.id,
    recipient_profile_id: isCustomer ? r.technician_id : r.customer_id,
    body: u.text.slice(0, 4000),
    delivered,
  });
  await reply(
    ctx,
    delivered
      ? `✅ _Forwarded to the ${isCustomer ? 'technician' : 'customer'}._`
      : `⚠️ Could not deliver your message to the ${isCustomer ? 'technician' : 'customer'}. Please try again shortly.`
  );
  return true;
}

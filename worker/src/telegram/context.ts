import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from './message-sender';
import { ParsedUpdate } from './message-parser';
import { Profile } from '../types/database';
import { UserSession, setUserSession, clearUserSession } from '../services/session-store';
import { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from '../types/telegram';

/** Everything a flow handler needs for one Telegram update. */
export interface BotContext {
  supabase: SupabaseClient;
  sender: MessageSender;
  profile: Profile;
  session: UserSession | null;
  u: ParsedUpdate;
  config: { supportChatId?: string };
}

export function reply(
  ctx: BotContext,
  text: string,
  replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove
): Promise<boolean> {
  return ctx.sender.sendMessage({ chatId: ctx.u.chatId, text, replyMarkup });
}

export function setStep(ctx: BotContext, step: string, data: Record<string, unknown> = {}): Promise<void> {
  return setUserSession(ctx.u.userId, step, data, ctx.supabase);
}

export function clearStep(ctx: BotContext): Promise<void> {
  return clearUserSession(ctx.u.userId, ctx.supabase);
}

/** True when the update is a callback whose data starts with `prefix`; returns the remainder. */
export function cb(ctx: BotContext, prefix: string): string | null {
  const data = ctx.u.callbackData;
  return data?.startsWith(prefix) ? data.slice(prefix.length) : null;
}

export function inStep(ctx: BotContext, step: string): boolean {
  return ctx.session?.step === step;
}

export const ACTIVE_JOB_STATUSES = ['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS'];

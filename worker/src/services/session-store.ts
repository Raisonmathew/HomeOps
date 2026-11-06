import { SupabaseClient } from '@supabase/supabase-js';

export interface UserSession {
  step: string;
  data: Record<string, unknown>;
  updated_at: number;
}

// Sessions live in the bot_sessions table: Worker memory is per-isolate, so a
// multi-step flow would otherwise lose its state between messages.
const SESSION_TTL_MS = 30 * 60 * 1000;

export async function getUserSession(
  telegramUserId: number,
  supabase: SupabaseClient
): Promise<UserSession | null> {
  const { data, error } = await supabase
    .from('bot_sessions')
    .select('step, data, updated_at')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load bot session:', error);
    return null;
  }
  if (!data) return null;

  const updatedAt = new Date(data.updated_at).getTime();
  if (Date.now() - updatedAt > SESSION_TTL_MS) return null;
  return { step: data.step, data: data.data ?? {}, updated_at: updatedAt };
}

export async function setUserSession(
  telegramUserId: number,
  step: string,
  data: Record<string, unknown> = {},
  supabase: SupabaseClient
): Promise<void> {
  const { error } = await supabase
    .from('bot_sessions')
    .upsert({ telegram_user_id: telegramUserId, step, data, updated_at: new Date().toISOString() });
  if (error) console.error('Failed to save bot session:', error);
}

export async function clearUserSession(telegramUserId: number, supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from('bot_sessions').delete().eq('telegram_user_id', telegramUserId);
  if (error) console.error('Failed to clear bot session:', error);
}

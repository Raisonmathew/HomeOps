import { SupabaseClient } from '@supabase/supabase-js';

export interface UserSession {
  step: string;
  data: Record<string, unknown>;
  updated_at: number;
}

// NOTE: This in-memory store is scoped to a single Cloudflare Worker isolate.
// Cloudflare Workers may run across many isolates; sessions will be lost on
// cold starts or when a request lands on a different instance, breaking
// multi-step Telegram conversations.  For production hardening, replace this
// Map with Cloudflare KV writes (setUserSession / getUserSession already
// accept a SupabaseClient parameter for this migration path).
const memorySessions = new Map<number, UserSession>();

export async function getUserSession(
  telegramUserId: number,
  _supabase?: SupabaseClient
): Promise<UserSession | null> {
  const cached = memorySessions.get(telegramUserId);
  if (cached && Date.now() - cached.updated_at < 30 * 60 * 1000) {
    return cached;
  }
  return null;
}

export async function setUserSession(
  telegramUserId: number,
  step: string,
  data: Record<string, unknown> = {},
  _supabase?: SupabaseClient
): Promise<void> {
  memorySessions.set(telegramUserId, {
    step,
    data,
    updated_at: Date.now(),
  });
}

export async function clearUserSession(telegramUserId: number): Promise<void> {
  memorySessions.delete(telegramUserId);
}

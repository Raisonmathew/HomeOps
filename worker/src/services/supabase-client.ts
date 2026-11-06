import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Separate secret for the /internal/* endpoints — must differ from TELEGRAM_WEBHOOK_SECRET (#16) */
  INTERNAL_API_SECRET: string;
  /** Dashboard origin allowed to call /api/operator/* (CORS), e.g. https://homeops.<sub>.workers.dev */
  DASHBOARD_ORIGIN?: string;
  /** Telegram chat (operator group) that receives Support messages from the bot */
  SUPPORT_CHAT_ID?: string;
}

export function getSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

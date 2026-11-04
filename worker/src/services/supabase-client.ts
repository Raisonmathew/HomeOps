import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Separate secret for the /internal/* endpoints — must differ from TELEGRAM_WEBHOOK_SECRET (#16) */
  INTERNAL_API_SECRET: string;
}

export function getSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

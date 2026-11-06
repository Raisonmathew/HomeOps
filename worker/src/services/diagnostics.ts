import { Env, getSupabaseClient } from './supabase-client';

/**
 * Self-check for deployment problems. Served at GET /internal/diagnostics behind
 * INTERNAL_API_SECRET. Reports only key *types*, counts and error messages,
 * never secret values.
 */
export async function runDiagnostics(env: Env): Promise<Record<string, unknown>> {
  return {
    env: {
      SUPABASE_URL: env.SUPABASE_URL || 'MISSING',
      SUPABASE_SERVICE_ROLE_KEY: describeSupabaseKey(env.SUPABASE_SERVICE_ROLE_KEY),
      TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ? 'set' : 'MISSING',
      TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET ? 'set' : 'MISSING',
    },
    database: await checkDatabase(env),
    telegram: await checkTelegram(env),
  };
}

/** The Worker needs a service-role key; an anon/publishable key is blocked by RLS. */
function describeSupabaseKey(key: string | undefined): string {
  if (!key) return 'MISSING';
  if (key.startsWith('sb_secret_')) return 'ok: sb_secret key';
  if (key.startsWith('sb_publishable_')) return 'WRONG: publishable key, use the secret/service_role key';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') return 'ok: legacy service_role JWT';
      return `WRONG: JWT with role "${payload.role}", use the service_role key`;
    } catch {
      return 'WRONG: unreadable JWT';
    }
  }
  return `WRONG: unrecognised key format (length ${key.length})`;
}

async function checkDatabase(env: Env): Promise<Record<string, unknown>> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'Supabase env missing' };
  const supabase = getSupabaseClient(env);
  const tables = ['processed_telegram_updates', 'profiles', 'service_categories', 'issue_types', 'operator_profiles'];
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    result[table] = error ? `ERROR: ${error.message || error.code}` : `${count} rows`;
  }
  return result;
}

async function checkTelegram(env: Env): Promise<Record<string, unknown>> {
  if (!env.TELEGRAM_BOT_TOKEN) return { skipped: 'TELEGRAM_BOT_TOKEN missing' };
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  try {
    const me = (await (await fetch(`${base}/getMe`)).json()) as any;
    if (!me.ok) return { bot: `ERROR: ${me.description}` };
    const info = (await (await fetch(`${base}/getWebhookInfo`)).json()) as any;
    const w = info.result || {};
    return {
      bot: `@${me.result.username}`,
      webhook_url: w.url || 'NOT SET',
      pending_update_count: w.pending_update_count,
      last_error_message: w.last_error_message || null,
      last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
      allowed_updates: w.allowed_updates || 'default',
    };
  } catch (err) {
    return { error: String(err) };
  }
}

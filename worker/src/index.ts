import { Env, getSupabaseClient } from './services/supabase-client';
import { validateWebhookSecret } from './security/webhook-validation';
import { handleTelegramWebhook } from './telegram/webhook-handler';
import { processExpiredBatches } from './matching/batch-progression';
import { MessageSender } from './telegram/message-sender';
import { TelegramUpdate } from './types/telegram';
import { runDiagnostics } from './services/diagnostics';
import { loadMarketplaceConfig } from './services/config';
import { requireOperator, assignByOperator, cancelByOperator, resolveByOperator } from './requests/operator-actions';
import { runJobSweeps } from './requests/sweeps';
import { applyAccountAction, AccountAction } from './trust/safety';

/** Must match the daily entry in wrangler.toml [triggers] crons (21:30 UTC = 03:00 IST). */
const DAILY_CRON = '30 21 * * *';

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json', ...extraHeaders } });

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/') {
      return json({ status: 'healthy', service: 'HomeOps Worker' });
    }

    // Telegram webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!validateWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response('Unauthorized webhook signature', { status: 401 });
      }
      try {
        const update = (await request.json()) as TelegramUpdate;
        const supabase = getSupabaseClient(env);
        await loadMarketplaceConfig(supabase);
        return await handleTelegramWebhook(update, supabase, env.TELEGRAM_BOT_TOKEN, { supportChatId: env.SUPPORT_CHAT_ID });
      } catch (err) {
        console.error('Unhandled webhook error:', err);
        return new Response('Internal error processing update', { status: 500 });
      }
    }

    // Dashboard operator actions (they need the Telegram token, which only the Worker holds)
    if (url.pathname.startsWith('/api/operator/')) {
      const cors = {
        // Bearer-token auth (no cookies), so a wildcard is safe if DASHBOARD_ORIGIN isn't set
        'Access-Control-Allow-Origin': env.DASHBOARD_ORIGIN || '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

      const supabase = getSupabaseClient(env);
      const operatorProfileId = await requireOperator(supabase, request.headers.get('Authorization'));
      if (!operatorProfileId) return json({ error: 'Not signed in as an active operator.' }, 401, cors);

      let body: { requestId?: string; technicianId?: string; reason?: string };
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body.' }, 400, cors);
      }
      const uuid = /^[0-9a-f-]{36}$/i;
      // Every action targets a request, except account moderation (targets a profile)
      if (url.pathname !== '/api/operator/account' && (!body.requestId || !uuid.test(body.requestId))) {
        return json({ error: 'requestId is required.' }, 400, cors);
      }

      await loadMarketplaceConfig(supabase);
      const sender = new MessageSender(env.TELEGRAM_BOT_TOKEN);
      let error: string | null;
      if (url.pathname === '/api/operator/assign') {
        if (!body.technicianId || !uuid.test(body.technicianId)) return json({ error: 'technicianId is required.' }, 400, cors);
        error = await assignByOperator(supabase, sender, operatorProfileId, body.requestId!,body.technicianId);
      } else if (url.pathname === '/api/operator/account') {
        const action = (body as any).action as AccountAction;
        const profileId = (body as any).profileId as string;
        const reason = ((body.reason ?? '') as string).trim().slice(0, 300);
        if (!profileId || !uuid.test(profileId)) return json({ error: 'profileId is required.' }, 400, cors);
        if (!['WARN', 'RESTRICT', 'SUSPEND', 'REACTIVATE'].includes(action)) return json({ error: 'Invalid action.' }, 400, cors);
        if (!reason) return json({ error: 'A reason is required.' }, 400, cors);
        error = await applyAccountAction(supabase, sender, env.SUPPORT_CHAT_ID, operatorProfileId, profileId, action, reason);
      } else if (url.pathname === '/api/operator/resolve') {
        error = await resolveByOperator(supabase, sender, operatorProfileId, body.requestId!,(body as any).outcome);
      } else if (url.pathname === '/api/operator/cancel') {
        error = await cancelByOperator(supabase, sender, operatorProfileId, body.requestId!,(body.reason ?? '').slice(0, 300));
      } else {
        return json({ error: 'Unknown operator action.' }, 404, cors);
      }
      return error ? json({ error }, 409, cors) : json({ ok: true }, 200, cors);
    }

    // Manual trigger for batch progression (same code as the cron)
    if (url.pathname === '/internal/expire-batches' && request.method === 'POST') {
      if (!env.INTERNAL_API_SECRET || request.headers.get('Authorization') !== `Bearer ${env.INTERNAL_API_SECRET}`) {
        return new Response('Unauthorized internal invocation', { status: 401 });
      }
      const supabase = getSupabaseClient(env);
      await loadMarketplaceConfig(supabase);
      return json(await processExpiredBatches(supabase, new MessageSender(env.TELEGRAM_BOT_TOKEN)));
    }

    // Deployment self-check (see services/diagnostics.ts)
    if (url.pathname === '/internal/diagnostics' && request.method === 'GET') {
      if (!env.INTERNAL_API_SECRET || request.headers.get('Authorization') !== `Bearer ${env.INTERNAL_API_SECRET}`) {
        return new Response('Unauthorized internal invocation', { status: 401 });
      }
      return json(await runDiagnostics(env));
    }

    return new Response('Not Found', { status: 404 });
  },

  // Cron triggers: every minute = batch progression (spec §18.1); daily = retention & metrics (spec §12)
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const supabase = getSupabaseClient(env);
    if (event.cron === DAILY_CRON) {
      const { data, error } = await supabase.rpc('run_daily_maintenance');
      if (error) console.error('Daily maintenance failed:', error);
      else console.log('Daily maintenance:', JSON.stringify(data));
      return;
    }
    await loadMarketplaceConfig(supabase);
    const sender = new MessageSender(env.TELEGRAM_BOT_TOKEN);
    await processExpiredBatches(supabase, sender);
    await runJobSweeps(supabase, sender, env.SUPPORT_CHAT_ID);
  },
};

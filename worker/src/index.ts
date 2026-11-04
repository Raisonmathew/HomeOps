import { Env, getSupabaseClient } from './services/supabase-client';
import { validateWebhookSecret } from './security/webhook-validation';
import { handleTelegramWebhook } from './telegram/webhook-handler';
import { processExpiredBatches } from './matching/batch-progression';
import { MessageSender } from './telegram/message-sender';
import { TelegramUpdate } from './types/telegram';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'healthy', service: 'HomeOps Worker' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Telegram webhook handler
    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!validateWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response('Unauthorized webhook signature', { status: 401 });
      }

      try {
        const update = (await request.json()) as TelegramUpdate;
        const supabase = getSupabaseClient(env);
        return await handleTelegramWebhook(update, supabase, env.TELEGRAM_BOT_TOKEN);
      } catch (err) {
        console.error('Unhandled webhook error:', err);
        return new Response('Internal error processing update', { status: 500 });
      }
    }

    // Alternative cron/internal trigger endpoint for batch expiration
    if (url.pathname === '/internal/expire-batches' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      // Use the dedicated internal secret, not the Telegram webhook secret (#16)
      if (!env.INTERNAL_API_SECRET || authHeader !== `Bearer ${env.INTERNAL_API_SECRET}`) {
        return new Response('Unauthorized internal invocation', { status: 401 });
      }

      const supabase = getSupabaseClient(env);
      const messageSender = new MessageSender(env.TELEGRAM_BOT_TOKEN);
      const result = await processExpiredBatches(supabase, messageSender);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  // Cloudflare Worker Cron Trigger Handler (Spec v1.1 Section 18.1)
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const supabase = getSupabaseClient(env);
    const messageSender = new MessageSender(env.TELEGRAM_BOT_TOKEN);
    await processExpiredBatches(supabase, messageSender);
  },
};

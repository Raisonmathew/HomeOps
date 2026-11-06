import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { CustomerNotifications } from '../notifications/customer-notifications';
import { dispatchOfferBatch } from './offer-batches';
import { findCandidates, SearchRequest, toSearchRequest } from './candidates';
import { Rematch } from '../requests/cancellation';
import { formatWindow } from '../telegram/format';
import { SEARCH_CONFIG } from '../config/constants';

export const MAX_OFFER_BATCHES = 3;

/**
 * After a request lost its technician (reopenSearch): tell the customer what happens next and,
 * if the slot is near, start the replacement search right away. A later booking keeps its slot and
 * the cron searches SEARCH.LEAD_TIME_HOURS before it.
 */
export async function startRematch(
  supabase: SupabaseClient,
  messageSender: MessageSender,
  job: any,
  rematch: Rematch,
  customerChatId: number | undefined,
  why: string
): Promise<void> {
  if (customerChatId) {
    await messageSender.sendMessage({
      chatId: customerChatId,
      text:
        rematch === 'NOW'
          ? `ℹ️ ${why} We're finding you another technician for \`${job.request_number}\` now.`
          : `ℹ️ ${why} Your booking \`${job.request_number}\` for ${formatWindow(job.preferred_start_time, job.preferred_end_time)} stays in place: we'll find you another technician about ${SEARCH_CONFIG.LEAD_TIME_HOURS} hours before the slot.`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: '🔎 Track request', callback_data: `req_view:${job.id}` }],
          [{ text: '❌ Cancel request', callback_data: `req_cancel:${job.id}` }],
        ],
      },
    });
  }
  if (rematch === 'NOW') await runSearchBatch(supabase, messageSender, toSearchRequest(job), 1);
}

/**
 * Sends offer batch `batchIndex` for a SEARCHING request: used for the first batch,
 * by the cron batch progression, and when a technician cancels and the search re-opens.
 * If nobody can be offered, the search is closed as NO_TECHNICIAN_FOUND and the customer told.
 */
export async function runSearchBatch(
  supabase: SupabaseClient,
  messageSender: MessageSender,
  req: SearchRequest,
  batchIndex: number
): Promise<'DISPATCHED' | 'EXHAUSTED'> {
  const candidates = batchIndex > MAX_OFFER_BATCHES ? [] : await findCandidates(supabase, req);
  const dispatched = candidates.length ? await dispatchOfferBatch(supabase, messageSender, req, batchIndex, candidates) : 0;

  const { error } = await supabase.rpc('finalize_batch_progression', {
    p_request_id: req.id,
    p_new_batch: batchIndex,
    p_search_exhausted: dispatched === 0,
  });
  if (error) console.error(`finalize_batch_progression failed for ${req.id}:`, error);

  if (dispatched > 0) return 'DISPATCHED';

  const { data: customer } = await supabase
    .from('service_requests')
    .select('customer:profiles!service_requests_customer_id_fkey(telegram_user_id)')
    .eq('id', req.id)
    .single();
  const chatId = (customer as any)?.customer?.telegram_user_id;
  if (chatId) await CustomerNotifications.notifyNoTechnicianFound(messageSender, chatId);
  return 'EXHAUSTED';
}

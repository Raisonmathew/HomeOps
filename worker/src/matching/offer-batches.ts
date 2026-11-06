import { SupabaseClient } from '@supabase/supabase-js';
import { ScoredCandidate } from '../types/matching';
import { BATCH_CONFIG } from '../config/constants';
import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { formatWindow, escapeMd } from '../telegram/format';
import { SearchRequest } from './candidates';
import { getProfileRating } from '../trust/ratings';

/**
 * Creates offers for the top candidates and sends the sanitized offer message (spec §6.6, §9.3).
 * `candidates` must already exclude technicians offered this request (findCandidates does).
 * Returns how many offers were delivered.
 */
export async function dispatchOfferBatch(
  supabase: SupabaseClient,
  messageSender: MessageSender,
  req: SearchRequest,
  batchIndex: number,
  candidates: ScoredCandidate[]
): Promise<number> {
  const batchSize = batchIndex === 1 ? BATCH_CONFIG.BATCH_1_SIZE : BATCH_CONFIG.BATCH_2_SIZE;
  const timeoutSec =
    batchIndex === 1
      ? BATCH_CONFIG.BATCH_1_TIMEOUT_SECONDS
      : batchIndex === 2
        ? BATCH_CONFIG.BATCH_2_TIMEOUT_SECONDS
        : BATCH_CONFIG.BATCH_3_TIMEOUT_SECONDS;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutSec * 1000).toISOString();
  let dispatchedCount = 0;

  // Same for every technician in the batch: photo availability and the customer's rating (two-way trust)
  const [{ count: photoCount }, { data: reqRow }] = await Promise.all([
    supabase.from('attachments').select('id', { count: 'exact', head: true }).eq('service_request_id', req.id).eq('attachment_type', 'ISSUE_PHOTO'),
    supabase.from('service_requests').select('customer_id').eq('id', req.id).single(),
  ]);
  const customerRating = reqRow ? await getProfileRating(supabase, reqRow.customer_id) : { avg: 0, count: 0 };
  const customerLine = customerRating.count
    ? `👤 *Customer rating:* ${customerRating.avg.toFixed(1)}/5 (${customerRating.count})\n`
    : `👤 *Customer:* new to HomeOps\n`;

  for (const candidate of candidates.slice(0, batchSize)) {
    // Upsert: in a re-opened search a technician can be re-offered (one row per request+technician).
    const { data: offerData, error } = await supabase
      .from('request_offers')
      .upsert(
        {
          service_request_id: req.id,
          technician_id: candidate.technician.technician_id,
          distance_km: candidate.distance_km,
          technician_radius_km: candidate.technician.effective_radius_km,
          match_score: candidate.match_score,
          match_explanation: candidate.explanation,
          offer_batch: batchIndex,
          offer_status: 'SENT',
          offered_at: now.toISOString(),
          viewed_at: null,
          responded_at: null,
          expires_at: expiresAt,
        },
        { onConflict: 'service_request_id,technician_id' }
      )
      .select('id')
      .single();

    if (error || !offerData) {
      console.error('Failed to create offer record:', error);
      continue;
    }

    // Fair-rotation counters (spec §18.3), updated DB-side to avoid read-modify-write races
    const { error: rpcError } = await supabase.rpc('increment_technician_offer_count', {
      p_technician_id: candidate.technician.technician_id,
      p_offered_at: now.toISOString(),
    });
    if (rpcError) console.error('Failed to update offer counters:', rpcError);

    // Offer-level data only: no exact address, coordinates or customer contact (spec §6.6)
    const offerText =
      `🔔 *New Service Request*\n\n` +
      `🛠 *Service:* ${escapeMd(req.category_name)}\n` +
      `🔧 *Issue:* ${escapeMd(req.issue_name)}\n` +
      `📍 *Area:* ${escapeMd(req.service_locality || 'Shared after you accept')}\n` +
      `📏 *Approx. straight-line distance:* ${candidate.distance_km} km\n` +
      `🕐 *Preferred time:* ${formatWindow(req.preferred_start_time, req.preferred_end_time)}\n` +
      `📷 *Photos available:* ${photoCount ? `Yes (${photoCount}), sent after you accept` : 'No'}\n` +
      customerLine +
      `⏱ Please respond within about ${Math.ceil(timeoutSec / 60)} min.\n\n` +
      `_Actual road distance and travel time may vary. Price and payment are agreed directly with the customer._`;

    const sent = await messageSender.sendMessage({
      chatId: candidate.technician.telegram_user_id,
      text: offerText,
      replyMarkup: KeyboardBuilder.offerActionButtons(offerData.id),
    });

    if (sent) {
      dispatchedCount++;
    } else {
      // Undelivered offers must not hold the batch open (spec §13: failed delivery must not corrupt state)
      await supabase.from('request_offers').update({ offer_status: 'CANCELLED' }).eq('id', offerData.id);
    }
  }

  return dispatchedCount;
}

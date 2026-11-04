import { SupabaseClient } from '@supabase/supabase-js';
import { ScoredCandidate } from '../types/matching';
import { BATCH_CONFIG } from '../config/constants';
import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';

export async function dispatchOfferBatch(
  supabase: SupabaseClient,
  messageSender: MessageSender,
  requestId: string,
  batchIndex: number,
  candidates: ScoredCandidate[],
  requestDetails: {
    categoryName: string;
    issueName: string;
    serviceArea: string;
    hasPhoto: boolean;
  }
): Promise<number> {
  const batchSize =
    batchIndex === 1 ? BATCH_CONFIG.BATCH_1_SIZE : BATCH_CONFIG.BATCH_2_SIZE;
  const timeoutSec =
    batchIndex === 1
      ? BATCH_CONFIG.BATCH_1_TIMEOUT_SECONDS
      : batchIndex === 2
        ? BATCH_CONFIG.BATCH_2_TIMEOUT_SECONDS
        : BATCH_CONFIG.BATCH_3_TIMEOUT_SECONDS; // #8: batch 3 uses 180s, not 90s
  const startIndex = (batchIndex - 1) * batchSize;
  const targetCandidates = candidates.slice(startIndex, startIndex + batchSize);

  if (targetCandidates.length === 0) {
    return 0;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutSec * 1000).toISOString();
  let dispatchedCount = 0;

  for (const candidate of targetCandidates) {
    // 1. Create offer record in Supabase with match_explanation
    const { data: offerData, error } = await supabase
      .from('request_offers')
      .insert({
        service_request_id: requestId,
        technician_id: candidate.technician.technician_id,
        distance_km: candidate.distance_km,
        technician_radius_km: candidate.technician.effective_radius_km,
        match_score: candidate.match_score,
        match_explanation: candidate.explanation,
        offer_batch: batchIndex,
        offer_status: 'SENT',
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (error || !offerData) {
      console.error('Failed to create offer record:', error);
      continue;
    }

    // 2. Update technician last_offered_at and atomically increment 7d offer count
    // Use a DB-side RPC to avoid a stale read-modify-write race (#14)
    await supabase.rpc('increment_technician_offer_count', {
      p_technician_id: candidate.technician.technician_id,
      p_offered_at: now.toISOString(),
    });

    // 3. Dispatch sanitized Offer-Level message to technician (NO exact customer coordinates/phone/address)
    const offerText =
      `🔔 *New Service Request Offer*\n\n` +
      `🛠 *Service:* ${requestDetails.categoryName} - ${requestDetails.issueName}\n` +
      `📍 *Approximate Area:* ${requestDetails.serviceArea}\n` +
      `📏 *Straight-Line Distance:* ~${candidate.distance_km} km\n` +
      `📷 *Photo attached:* ${requestDetails.hasPhoto ? 'Yes' : 'No'}\n` +
      `⏱ *Offer expires in:* ~${timeoutSec}s\n\n` +
      `_Pricing, scope, and payment are agreed directly between you and the customer._`;

    const sent = await messageSender.sendMessage({
      chatId: candidate.technician.telegram_user_id,
      text: offerText,
      replyMarkup: KeyboardBuilder.offerActionButtons(requestId, offerData.id),
    });

    if (sent) {
      dispatchedCount++;
    }
  }

  return dispatchedCount;
}

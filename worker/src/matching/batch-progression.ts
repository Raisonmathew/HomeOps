import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';
import { runSearchBatch } from './search';
import { SearchRequest } from './candidates';

export interface BatchProgressionResult {
  claimedRequests: number;
  advancedCount: number;
  exhaustedCount: number;
}

/** Cron job (spec §18.1): advance every SEARCHING request whose current batch has no live offers left. */
export async function processExpiredBatches(
  supabase: SupabaseClient,
  messageSender: MessageSender
): Promise<BatchProgressionResult> {
  const { data: claimed, error } = await supabase.rpc('claim_expired_search_requests', {
    p_claim_timeout_seconds: 120,
  });

  if (error) console.error('claim_expired_search_requests failed:', error);
  if (error || !claimed || claimed.length === 0) {
    return { claimedRequests: 0, advancedCount: 0, exhaustedCount: 0 };
  }

  let advancedCount = 0;
  let exhaustedCount = 0;

  for (const row of claimed as any[]) {
    const req: SearchRequest = { ...row, id: row.request_id };
    // current_batch is 0 for a scheduled request whose search hasn't started yet
    const outcome = await runSearchBatch(supabase, messageSender, req, (row.current_batch ?? 0) + 1);
    if (outcome === 'DISPATCHED') advancedCount++;
    else exhaustedCount++;
  }

  return { claimedRequests: claimed.length, advancedCount, exhaustedCount };
}

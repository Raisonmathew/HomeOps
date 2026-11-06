import { SupabaseClient } from '@supabase/supabase-js';
import { BATCH_CONFIG, MATCHING_WEIGHTS, SEARCH_CONFIG, SAFETY_CONFIG, SLA_CONFIG, LIMITS_CONFIG } from '../config/constants';

// Overlays operator-edited marketplace_config rows (keys like "BATCH_CONFIG.BATCH_1_SIZE")
// onto the in-code defaults, so settings change without a deploy (spec §6.5).
// shortcut: mutates the shared constant objects per isolate; fine while every reader is in this Worker.
const TARGETS: Record<string, Record<string, number>> = {
  MATCHING_WEIGHTS,
  BATCH_CONFIG,
  SEARCH: SEARCH_CONFIG,
  SAFETY: SAFETY_CONFIG,
  SLA: SLA_CONFIG,
  LIMITS: LIMITS_CONFIG,
};
const REFRESH_MS = 60_000;
let loadedAt = 0;

export async function loadMarketplaceConfig(supabase: SupabaseClient): Promise<void> {
  if (Date.now() - loadedAt < REFRESH_MS) return;
  const { data, error } = await supabase.from('marketplace_config').select('key, value');
  if (error) {
    console.error('Could not load marketplace_config, using defaults:', error.message);
    return;
  }
  for (const row of data ?? []) {
    const [group, name] = String(row.key).split('.');
    const target = TARGETS[group];
    if (target && name in target && Number.isFinite(Number(row.value))) target[name] = Number(row.value);
  }
  loadedAt = Date.now();
}

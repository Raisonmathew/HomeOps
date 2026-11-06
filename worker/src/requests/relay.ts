import { SupabaseClient } from '@supabase/supabase-js';

/** Stops the bot-mediated relay for a request once the job is over (spec §18.2). */
export async function closeRelay(supabase: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await supabase
    .from('assignment_conversations')
    .update({ relay_status: 'CLOSED', closed_at: new Date().toISOString() })
    .eq('service_request_id', requestId)
    .eq('relay_status', 'ACTIVE');
  if (error) console.error(`Failed to close relay for ${requestId}:`, error);
}

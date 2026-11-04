import { SupabaseClient } from '@supabase/supabase-js';
import { AccountStatus } from '../types/database';

export async function updateAccountStatus(
  supabase: SupabaseClient,
  profileId: string,
  status: AccountStatus
): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({ account_status: status })
    .eq('id', profileId);

  return !error;
}

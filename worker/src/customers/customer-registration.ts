import { SupabaseClient } from '@supabase/supabase-js';
import { Profile } from '../types/database';
import { PRIVACY_TERMS_VERSION } from '../config/constants';

export async function getOrCreateCustomerProfile(
  supabase: SupabaseClient,
  telegramUserId: number,
  fullName: string,
  telegramUsername?: string
): Promise<Profile | null> {
  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single();

  // PGRST116 = "no rows" from .single(), i.e. a new user. Anything else is a real failure
  // (bad key, RLS blocking a non-service key, missing table) and must not be hidden.
  if (selectError && selectError.code !== 'PGRST116') {
    console.error('Failed to look up profile:', selectError);
    return null;
  }

  if (existing && !selectError) {
    if (telegramUsername && existing.telegram_username !== telegramUsername) {
      await supabase
        .from('profiles')
        .update({ telegram_username: telegramUsername })
        .eq('id', existing.id);
    }
    return existing as Profile;
  }

  const { data: created, error: insertError } = await supabase
    .from('profiles')
    .insert({
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername || null,
      full_name: fullName,
      role: 'CUSTOMER',
      account_status: 'ACTIVE',
      accepted_terms_version: PRIVACY_TERMS_VERSION,
      accepted_terms_at: new Date().toISOString(),
      allow_direct_contact_after_assignment: true,
    })
    .select('*')
    .single();

  if (insertError) {
    console.error('Failed to create customer profile:', insertError);
    return null;
  }

  console.log(`Created profile ${created.id} for Telegram user ${telegramUserId}`);
  return created as Profile;
}

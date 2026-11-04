import { SupabaseClient } from '@supabase/supabase-js';

export async function applyAsTechnician(
  supabase: SupabaseClient,
  profileId: string,
  params: {
    experienceYears: number;
    profileSummary?: string;
    baseLatitude: number;
    baseLongitude: number;
    defaultRadiusKm: number;
  }
): Promise<boolean> {
  // Update role in profiles
  await supabase
    .from('profiles')
    .update({ role: 'TECHNICIAN' })
    .eq('id', profileId);

  // Insert or update technician profile
  const { error } = await supabase.from('technician_profiles').upsert(
    {
      profile_id: profileId,
      verification_status: 'APPLIED',
      experience_years: params.experienceYears,
      profile_summary: params.profileSummary || null,
      base_latitude: params.baseLatitude,
      base_longitude: params.baseLongitude,
      default_radius_km: params.defaultRadiusKm,
      probation_status: 'NOT_STARTED',
    },
    { onConflict: 'profile_id' }
  );

  return !error;
}

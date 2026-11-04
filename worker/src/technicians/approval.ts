import { SupabaseClient } from '@supabase/supabase-js';
import { VerificationStatus } from '../types/database';

export async function setTechnicianVerificationStatus(
  supabase: SupabaseClient,
  technicianId: string,
  status: VerificationStatus,
  /** profile_id of the operator performing the approval */
  approvedByProfileId: string
): Promise<boolean> {
  // Spec §6.2: a technician cannot approve their own role or skill.
  // Verify the approver is not the same profile as the technician being approved (#18).
  const { data: techProfile } = await supabase
    .from('technician_profiles')
    .select('profile_id')
    .eq('id', technicianId)
    .single();

  if (techProfile && techProfile.profile_id === approvedByProfileId) {
    console.error('Self-approval attempt blocked: technician cannot approve their own profile');
    return false;
  }

  const { error } = await supabase
    .from('technician_profiles')
    .update({ verification_status: status })
    .eq('id', technicianId);

  return !error;
}

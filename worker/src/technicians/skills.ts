import { SupabaseClient } from '@supabase/supabase-js';

export async function addTechnicianSkill(
  supabase: SupabaseClient,
  technicianId: string,
  categoryId: string,
  issueTypeId?: string
): Promise<boolean> {
  const { error } = await supabase.from('technician_skills').insert({
    technician_id: technicianId,
    service_category_id: categoryId,
    issue_type_id: issueTypeId || null,
    approval_status: 'PENDING',
  });

  return !error;
}

export async function approveTechnicianSkill(
  supabase: SupabaseClient,
  skillId: string,
  approvedByProfileId: string
): Promise<boolean> {
  // Spec §6.2: a technician cannot approve their own skills (#18).
  const { data: skill } = await supabase
    .from('technician_skills')
    .select('technician_profiles!inner(profile_id)')
    .eq('id', skillId)
    .single();

  const ownerProfileId = (skill as any)?.technician_profiles?.profile_id;
  if (ownerProfileId && ownerProfileId === approvedByProfileId) {
    console.error('Self-approval attempt blocked: technician cannot approve their own skill');
    return false;
  }

  const { error } = await supabase
    .from('technician_skills')
    .update({
      approval_status: 'APPROVED',
      approved_by: approvedByProfileId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', skillId);

  return !error;
}

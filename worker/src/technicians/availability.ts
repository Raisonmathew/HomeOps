import { SupabaseClient } from '@supabase/supabase-js';

export async function setTechnicianOnline(
  supabase: SupabaseClient,
  technicianId: string,
  params: {
    latitude: number;
    longitude: number;
    effectiveRadiusKm: number;
    validHours?: number;
  }
): Promise<boolean> {
  const hours = params.validHours || 8;
  // Close any previous session first, so matching never sees two ONLINE rows with different locations.
  await setTechnicianOffline(supabase, technicianId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const { error } = await supabase.from('technician_availability').insert({
    technician_id: technicianId,
    availability_status: 'ONLINE',
    current_latitude: params.latitude,
    current_longitude: params.longitude,
    effective_radius_km: params.effectiveRadiusKm,
    available_from: now.toISOString(),
    available_until: expiresAt.toISOString(),
    location_updated_at: now.toISOString(),
    location_expires_at: expiresAt.toISOString(),
  });

  return !error;
}

export async function setTechnicianOffline(
  supabase: SupabaseClient,
  technicianId: string
): Promise<boolean> {
  // Update the most recent ONLINE session rather than inserting a new row (#15).
  // Inserting would leave a zombie ONLINE row that the eligibility filter would
  // pick up as a valid session until its location_expires_at elapses.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('technician_availability')
    .update({
      availability_status: 'OFFLINE',
      effective_radius_km: 0,
      available_until: now,
      location_expires_at: now,
    })
    .eq('technician_id', technicianId)
    .eq('availability_status', 'ONLINE');

  return !error;
}

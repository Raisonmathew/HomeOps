import { SupabaseClient } from '@supabase/supabase-js';

export interface ActiveLocationSession {
  latitude: number;
  longitude: number;
  effectiveRadiusKm: number;
  isExpired: boolean;
}

export async function getActiveTechnicianLocation(
  supabase: SupabaseClient,
  technicianId: string
): Promise<ActiveLocationSession | null> {
  const { data } = await supabase
    .from('technician_availability')
    .select('*')
    .eq('technician_id', technicianId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data || data.availability_status !== 'ONLINE') {
    return null;
  }

  const isExpired = new Date(data.location_expires_at) < new Date();

  return {
    latitude: data.current_latitude,
    longitude: data.current_longitude,
    effectiveRadiusKm: data.effective_radius_km,
    isExpired,
  };
}

// Turns a shared Telegram location into readable text.
// shortcut: uses the free OpenStreetMap Nominatim API (1 request/second policy), fine for a pilot;
// switch to a paid geocoder before traffic grows.

export interface GeocodedPlace {
  /** Full readable address, shown only to the customer and (after assignment) the technician */
  address: string;
  /** General area (suburb/neighbourhood), safe to show in pre-assignment offers (spec §6.6) */
  locality: string | null;
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodedPlace | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=en`,
      { headers: { 'User-Agent': 'HomeOps-Pilot/0.1 (Telegram service-marketplace bot)' }, signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string; address?: Record<string, string> };
    if (!data.display_name) return null;
    const a = data.address ?? {};
    return {
      address: data.display_name,
      locality: a.suburb || a.neighbourhood || a.city_district || a.quarter || a.town || a.village || a.city || null,
    };
  } catch (err) {
    // Logged without coordinates (spec §11.15)
    console.error('Reverse geocoding failed:', String(err));
    return null;
  }
}

import { SupabaseClient } from '@supabase/supabase-js';

export interface SavedAddress {
  id: string;
  customer_id: string;
  label: string;
  address_text: string;
  latitude: number;
  longitude: number;
}

export async function getCustomerSavedAddresses(
  supabase: SupabaseClient,
  customerProfileId: string
): Promise<SavedAddress[]> {
  const { data } = await supabase
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerProfileId)
    .eq('active', true);

  return (data as SavedAddress[]) || [];
}

export async function saveCustomerAddress(
  supabase: SupabaseClient,
  address: {
    customerId: string;
    label: string;
    addressText: string;
    latitude: number;
    longitude: number;
  }
): Promise<boolean> {
  const { error } = await supabase.from('customer_addresses').insert({
    customer_id: address.customerId,
    label: address.label,
    address_text: address.addressText,
    latitude: address.latitude,
    longitude: address.longitude,
  });

  return !error;
}

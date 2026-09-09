import { supabase } from '@/src/lib/supabase';
import type { FuelEvent, FuelPhotoType, NewFuelEventInput } from './types';

export type LastFuelEvent = FuelEvent & { driver_name: string | null };

export async function getLastFuelEvent(vehicleId: string): Promise<LastFuelEvent | null> {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('*, drivers(name)')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { drivers, ...event } = data as FuelEvent & { drivers: { name: string } | null };
  return { ...event, driver_name: drivers?.name ?? null };
}

export async function listFuelEvents(vehicleId: string): Promise<LastFuelEvent[]> {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('*, drivers(name)')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const { drivers, ...event } = row as FuelEvent & { drivers: { name: string } | null };
    return { ...event, driver_name: drivers?.name ?? null };
  });
}

export async function createFuelEvent(input: NewFuelEventInput): Promise<FuelEvent> {
  const { data, error } = await supabase
    .from('fuel_events')
    .insert({
      vehicle_id: input.vehicleId,
      driver_id: input.driverId,
      event_date: input.eventDate,
      km: input.km,
      liters: input.liters,
      unit_price: input.unitPrice,
      amount: input.amount,
      station: input.station,
      notes: input.notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Upload (ou remplace) la photo d'un emplacement donné pour un plein.
 * Chemin de stockage stable par (fuel_event, type) + upsert : une reprise de photo
 * écrase l'ancien blob en place, jamais d'orphelin dans le bucket.
 */
export async function uploadFuelEventPhoto(params: {
  fuelEventId: string;
  ownerId: string;
  type: FuelPhotoType;
  localUri: string;
}): Promise<void> {
  const { fuelEventId, ownerId, type, localUri } = params;
  const storagePath = `${ownerId}/${fuelEventId}/${type}.jpg`;

  const response = await fetch(localUri);
  const arrayBuffer = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('fuel-photos')
    .upload(storagePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase
    .from('photos')
    .upsert(
      { fuel_event_id: fuelEventId, type, storage_path: storagePath },
      { onConflict: 'fuel_event_id,type' }
    );
  if (dbError) throw dbError;
}

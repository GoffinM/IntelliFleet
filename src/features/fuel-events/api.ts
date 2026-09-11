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

export type FuelEventPhotos = Partial<Record<FuelPhotoType, { storagePath: string; signedUrl: string }>>;
export type FuelEventWithPhotos = FuelEvent & { photos: FuelEventPhotos };

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

/** Charge un plein existant + URL signées (1h) de ses photos, pour l'écran d'édition. */
export async function getFuelEvent(id: string): Promise<FuelEventWithPhotos> {
  const { data: event, error } = await supabase.from('fuel_events').select('*').eq('id', id).single();
  if (error) throw error;

  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('type, storage_path')
    .eq('fuel_event_id', id);
  if (photosError) throw photosError;

  const photos: FuelEventPhotos = {};
  for (const row of photoRows ?? []) {
    const type = row.type as FuelPhotoType;
    const { data: signedData, error: signError } = await supabase.storage
      .from('fuel-photos')
      .createSignedUrl(row.storage_path, 3600);
    if (signError) throw signError;
    photos[type] = { storagePath: row.storage_path, signedUrl: signedData.signedUrl };
  }

  return { ...event, photos };
}

export async function updateFuelEvent(id: string, input: NewFuelEventInput): Promise<FuelEvent> {
  const { data, error } = await supabase
    .from('fuel_events')
    .update({
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
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Supprime un plein. Storage d'abord, puis la ligne DB : si le storage échoue, la ligne
 * reste et le souci reste détectable/rejouable — l'inverse laisserait des blobs orphelins
 * sans plus aucune référence pour les retrouver (le cascade SQL ne nettoie que les lignes
 * de la table photos, jamais les objets réels du bucket).
 */
export async function deleteFuelEvent(id: string): Promise<void> {
  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('fuel_event_id', id);
  if (photosError) throw photosError;

  const paths = (photoRows ?? []).map((row) => row.storage_path);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from('fuel-photos').remove(paths);
    if (removeError) throw removeError;
  }

  const { error } = await supabase.from('fuel_events').delete().eq('id', id);
  if (error) throw error;
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

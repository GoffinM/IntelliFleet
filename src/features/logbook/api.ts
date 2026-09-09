import { supabase } from '@/src/lib/supabase';
import type { LogbookEntry, NewLogbookEntryInput } from './types';

export type LogbookEntryWithDriver = LogbookEntry & { driver_name: string | null };

export async function listLogbookEntries(vehicleId: string): Promise<LogbookEntryWithDriver[]> {
  const { data, error } = await supabase
    .from('logbook_entries')
    .select('*, drivers(name)')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const { drivers, ...entry } = row as LogbookEntry & { drivers: { name: string } | null };
    return { ...entry, driver_name: drivers?.name ?? null };
  });
}

export async function createLogbookEntry(input: NewLogbookEntryInput): Promise<LogbookEntry> {
  const { data, error } = await supabase
    .from('logbook_entries')
    .insert({
      vehicle_id: input.vehicleId,
      driver_id: input.driverId,
      km: input.km,
      event_date: input.eventDate,
      comment: input.comment,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Upload (ou remplace) la photo d'un relevé. Chemin de stockage stable par relevé + upsert :
 * une reprise de photo écrase l'ancien blob en place, jamais d'orphelin (même stratégie que
 * les photos de plein). Une seule colonne à mettre à jour ensuite, pas de table séparée.
 */
export async function uploadLogbookEntryPhoto(params: {
  logbookEntryId: string;
  ownerId: string;
  localUri: string;
}): Promise<void> {
  const { logbookEntryId, ownerId, localUri } = params;
  const storagePath = `${ownerId}/${logbookEntryId}.jpg`;

  const response = await fetch(localUri);
  const arrayBuffer = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('logbook-photos')
    .upload(storagePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase
    .from('logbook_entries')
    .update({ photo_storage_path: storagePath })
    .eq('id', logbookEntryId);
  if (dbError) throw dbError;
}

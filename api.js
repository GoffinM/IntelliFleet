// Couche data Supabase — port direct des fichiers src/features/*/api.ts de la version
// React Native, adapté au File/Blob natif du navigateur (input file) au lieu de
// fetch(uri).arrayBuffer() sur un chemin local RN.
import { supabase } from './supabase-client.js';

export const PHOTO_TYPES = [
  { type: 'vehicle_plate', label: 'Véhicule + plaque' },
  { type: 'odometer', label: 'Compteur' },
  { type: 'pump', label: 'Pompe' },
  { type: 'receipt', label: 'Ticket' },
];

// ---------- Vehicles / Drivers ----------

export async function listVehicles() {
  const { data, error } = await supabase.from('vehicles').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

export async function listDrivers() {
  const { data, error } = await supabase.from('drivers').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data;
}

/** Création admin only côté RLS (0005_fleet_multi_user.sql) — l'UI n'est qu'une commodité. */
export async function createVehicle(input) {
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      name: input.name,
      plate: input.plate,
      make: input.make,
      model: input.model,
      year: input.year,
      initial_km: input.initialKm,
      tank_capacity_liters: input.tankCapacityLiters,
      fleet_group: input.fleetGroup,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Création admin only côté RLS (0005_fleet_multi_user.sql) — l'UI n'est qu'une commodité. */
export async function createDriver(input) {
  const { data, error } = await supabase.from('drivers').insert({ name: input.name }).select().single();
  if (error) throw error;
  return data;
}

// ---------- Profils (0005_fleet_multi_user.sql) ----------

/** Profil (role admin/driver) de l'utilisateur connecté. null si aucune ligne (compte non configuré). */
export async function getMyProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// ---------- Fuel events ----------

function mapFuelEventRow(row) {
  const { drivers, ...event } = row;
  return { ...event, driver_name: drivers?.name ?? null };
}

export async function getLastFuelEvent(vehicleId) {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('*, drivers(name)')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapFuelEventRow(data) : null;
}

export async function listFuelEvents(vehicleId) {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('*, drivers(name)')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapFuelEventRow);
}

export async function createFuelEvent(input) {
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

export async function updateFuelEvent(id, input) {
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

/** Charge un plein existant + URL signées (1h) de ses photos, pour l'écran d'édition. */
export async function getFuelEvent(id) {
  const { data: event, error } = await supabase.from('fuel_events').select('*').eq('id', id).single();
  if (error) throw error;

  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('type, storage_path')
    .eq('fuel_event_id', id);
  if (photosError) throw photosError;

  const photos = {};
  for (const row of photoRows ?? []) {
    const { data: signedData, error: signError } = await supabase.storage
      .from('fuel-photos')
      .createSignedUrl(row.storage_path, 3600);
    if (signError) throw signError;
    photos[row.type] = { storagePath: row.storage_path, signedUrl: signedData.signedUrl };
  }

  return { ...event, photos };
}

/**
 * Upload (ou remplace) la photo d'un emplacement donné pour un plein.
 * Chemin de stockage stable par (fuel_event, type) + upsert : une reprise de photo
 * écrase l'ancien blob en place, jamais d'orphelin dans le bucket.
 */
export async function uploadFuelEventPhoto({ fuelEventId, ownerId, type, file }) {
  const storagePath = `${ownerId}/${fuelEventId}/${type}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('fuel-photos')
    .upload(storagePath, file, { contentType: file.type || 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase
    .from('photos')
    .upsert({ fuel_event_id: fuelEventId, type, storage_path: storagePath }, { onConflict: 'fuel_event_id,type' });
  if (dbError) throw dbError;
}

/**
 * Supprime un plein. Storage d'abord, puis la ligne DB : si le storage échoue, la ligne
 * reste et le souci reste détectable/rejouable — l'inverse laisserait des blobs
 * orphelins sans plus aucune référence pour les retrouver.
 */
export async function deleteFuelEvent(id) {
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

// ---------- Logbook entries ----------

function mapLogbookRow(row) {
  const { drivers, ...entry } = row;
  return { ...entry, driver_name: drivers?.name ?? null };
}

export async function listLogbookEntries(vehicleId) {
  const { data, error } = await supabase
    .from('logbook_entries')
    .select('*, drivers(name)')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapLogbookRow);
}

export async function createLogbookEntry(input) {
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

export async function updateLogbookEntry(id, input) {
  const { data, error } = await supabase
    .from('logbook_entries')
    .update({
      vehicle_id: input.vehicleId,
      driver_id: input.driverId,
      km: input.km,
      event_date: input.eventDate,
      comment: input.comment,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Charge un relevé existant + URL signée (1h) de sa photo, pour l'écran d'édition. */
export async function getLogbookEntry(id) {
  const { data, error } = await supabase.from('logbook_entries').select('*').eq('id', id).single();
  if (error) throw error;

  let photoSignedUrl = null;
  if (data.photo_storage_path) {
    const { data: signedData, error: signError } = await supabase.storage
      .from('logbook-photos')
      .createSignedUrl(data.photo_storage_path, 3600);
    if (signError) throw signError;
    photoSignedUrl = signedData.signedUrl;
  }

  return { ...data, photoSignedUrl };
}

export async function uploadLogbookEntryPhoto({ logbookEntryId, ownerId, file }) {
  const storagePath = `${ownerId}/${logbookEntryId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('logbook-photos')
    .upload(storagePath, file, { contentType: file.type || 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase
    .from('logbook_entries')
    .update({ photo_storage_path: storagePath })
    .eq('id', logbookEntryId);
  if (dbError) throw dbError;
}

/** Supprime un relevé. Storage d'abord, puis la ligne DB (même ordre que deleteFuelEvent). */
export async function deleteLogbookEntry(id) {
  const { data: entry, error: fetchError } = await supabase
    .from('logbook_entries')
    .select('photo_storage_path')
    .eq('id', id)
    .single();
  if (fetchError) throw fetchError;

  if (entry?.photo_storage_path) {
    const { error: removeError } = await supabase.storage.from('logbook-photos').remove([entry.photo_storage_path]);
    if (removeError) throw removeError;
  }

  const { error } = await supabase.from('logbook_entries').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Validation admin (0005_fleet_multi_user.sql) ----------

async function signPhoto(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

async function mapValidationFuelRow(row) {
  const photos = await Promise.all(
    (row.photos ?? []).map(async (p) => ({ type: p.type, signedUrl: await signPhoto('fuel-photos', p.storage_path) }))
  );
  return {
    kind: 'fuel',
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.event_date,
    createdAt: row.created_at,
    km: row.km,
    liters: row.liters,
    amount: row.amount,
    vehicleName: row.vehicles?.name ?? '',
    driverName: row.drivers?.name ?? null,
    validatedAt: row.validated_at,
    photos,
  };
}

async function mapValidationLogbookRow(row) {
  const photos = row.photo_storage_path
    ? [{ type: 'odometer', signedUrl: await signPhoto('logbook-photos', row.photo_storage_path) }]
    : [];
  return {
    kind: 'logbook',
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.event_date,
    createdAt: row.created_at,
    km: row.km,
    liters: null,
    amount: null,
    vehicleName: row.vehicles?.name ?? '',
    driverName: row.drivers?.name ?? null,
    validatedAt: row.validated_at,
    photos,
  };
}

export async function listUnvalidatedFuelEvents() {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('*, vehicles(name), drivers(name), photos(type, storage_path)')
    .is('validated_at', null)
    .order('event_date', { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(mapValidationFuelRow));
}

export async function listUnvalidatedLogbookEntries() {
  const { data, error } = await supabase
    .from('logbook_entries')
    .select('*, vehicles(name), drivers(name)')
    .is('validated_at', null)
    .order('event_date', { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(mapValidationLogbookRow));
}

/** Les N entrées validées le plus récemment, tous chauffeurs confondus — sert à afficher
 *  le bouton "Supprimer les photos" sans avoir à lister indéfiniment tout l'historique. */
export async function listRecentlyValidatedFuelEvents(limit = 20) {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('*, vehicles(name), drivers(name), photos(type, storage_path)')
    .not('validated_at', 'is', null)
    .order('validated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return Promise.all((data ?? []).map(mapValidationFuelRow));
}

export async function listRecentlyValidatedLogbookEntries(limit = 20) {
  const { data, error } = await supabase
    .from('logbook_entries')
    .select('*, vehicles(name), drivers(name)')
    .not('validated_at', 'is', null)
    .order('validated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return Promise.all((data ?? []).map(mapValidationLogbookRow));
}

export async function validateFuelEvent(id) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('fuel_events')
    .update({ validated_at: new Date().toISOString(), validated_by: user.id })
    .eq('id', id);
  if (error) throw error;
}

export async function validateLogbookEntry(id) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('logbook_entries')
    .update({ validated_at: new Date().toISOString(), validated_by: user.id })
    .eq('id', id);
  if (error) throw error;
}

/** Supprime les photos d'un plein déjà validé (Storage puis lignes DB), sans toucher au
 *  plein lui-même — action séparée et volontaire, jamais automatique à la validation. */
export async function deleteFuelEventPhotos(id) {
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

  const { error } = await supabase.from('photos').delete().eq('fuel_event_id', id);
  if (error) throw error;
}

/** Supprime la photo d'un relevé déjà validé (Storage puis champ DB), sans toucher au
 *  relevé lui-même. */
export async function deleteLogbookEntryPhoto(id) {
  const { data: entry, error: fetchError } = await supabase
    .from('logbook_entries')
    .select('photo_storage_path')
    .eq('id', id)
    .single();
  if (fetchError) throw fetchError;

  if (entry?.photo_storage_path) {
    const { error: removeError } = await supabase.storage.from('logbook-photos').remove([entry.photo_storage_path]);
    if (removeError) throw removeError;
  }

  const { error } = await supabase.from('logbook_entries').update({ photo_storage_path: null }).eq('id', id);
  if (error) throw error;
}

// ---------- Tableau de bord (0006_fleet_group.sql) ----------
// Lecture seule, restreinte aux entrées validées — jamais les entrées en attente.

function mapDashboardRow(row) {
  const { drivers, ...rest } = row;
  return { ...rest, driver_name: drivers?.name ?? null };
}

/** Tous les fuel_events validés, toutes flottes — source du tableau de bord. */
export async function listValidatedFuelEventsAll() {
  const { data, error } = await supabase
    .from('fuel_events')
    .select('id, vehicle_id, driver_id, event_date, km, liters, amount, created_at, drivers(name)')
    .not('validated_at', 'is', null)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDashboardRow);
}

/** Tous les logbook_entries validés, toutes flottes — source du tableau de bord. */
export async function listValidatedLogbookEntriesAll() {
  const { data, error } = await supabase
    .from('logbook_entries')
    .select('id, vehicle_id, driver_id, event_date, km, created_at, drivers(name)')
    .not('validated_at', 'is', null)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDashboardRow);
}

/** Nombre total d'entrées (pleins + relevés) en attente de validation, tous chauffeurs
 *  confondus — affiché en badge sur le lien "Validation" de l'accueil admin. */
export async function countUnvalidatedEntries() {
  const [fuelRes, logbookRes] = await Promise.all([
    supabase.from('fuel_events').select('id', { count: 'exact', head: true }).is('validated_at', null),
    supabase.from('logbook_entries').select('id', { count: 'exact', head: true }).is('validated_at', null),
  ]);
  if (fuelRes.error) throw fuelRes.error;
  if (logbookRes.error) throw logbookRes.error;
  return (fuelRes.count ?? 0) + (logbookRes.count ?? 0);
}

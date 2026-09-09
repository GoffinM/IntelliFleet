-- IntelliFleet — Tranche 1.2 — photo optionnelle sur les relevés de compteur (logbook_entries)

-- ============================================================
-- Colonne photo sur logbook_entries : une seule photo par relevé,
-- pas la table photos existante (celle-ci est conçue autour de fuel_event_id + 4 types).
-- ============================================================
alter table public.logbook_entries
  add column photo_storage_path text;

-- RLS de logbook_entries déjà en place depuis 0003 (owner_id = auth.uid()) — aucun changement
-- nécessaire ici, la colonne hérite de la même policy "owner full access" sur toute la ligne.

-- ============================================================
-- Bucket Storage séparé, même patron que fuel-photos.
-- Chemin stable {owner_id}/{logbook_entry_id}.jpg + upsert côté app : pas de versionnage
-- par timestamp, pas de blob orphelin (même stratégie que les photos de plein).
-- ============================================================
insert into storage.buckets (id, name, public) values ('logbook-photos', 'logbook-photos', false)
on conflict (id) do nothing;

create policy "owner read own logbook photos" on storage.objects
  for select using (bucket_id = 'logbook-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner write own logbook photos" on storage.objects
  for insert with check (bucket_id = 'logbook-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner update own logbook photos" on storage.objects
  for update using (bucket_id = 'logbook-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'logbook-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner delete own logbook photos" on storage.objects
  for delete using (bucket_id = 'logbook-photos' and (storage.foldername(name))[1] = auth.uid()::text);

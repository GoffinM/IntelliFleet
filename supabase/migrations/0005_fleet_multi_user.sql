-- IntelliFleet — Tranche 2 — modèle multi-utilisateur de flotte (admin + chauffeurs)

-- ============================================================
-- PROFILES : un compte réel par utilisateur Supabase Auth (admin ou chauffeur).
-- Distinct de la table drivers existante (référence simple, pas un compte) : les
-- deux coexistent — un profil "driver" peut se connecter et saisir ses propres
-- pleins/relevés ; la table drivers reste le champ "chauffeur" descriptif optionnel
-- sur un événement (qui peut différer de la personne connectée, ex. un admin qui
-- saisit pour le compte d'un chauffeur).
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'driver')),
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ============================================================
-- Fonctions SECURITY DEFINER : une policy sur profiles qui interrogerait profiles
-- directement se re-déclencherait elle-même (récursion RLS classique). Ces fonctions
-- sont détenues par le rôle qui exécute cette migration (postgres, bypass RLS) : leur
-- lecture de profiles ne repasse jamais par les policies de profiles elles-mêmes.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_fleet_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid()
  );
$$;

create policy "profiles visible to self or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles inserted by admin" on public.profiles
  for insert with check (public.is_admin());
create policy "profiles updated by admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());
create policy "profiles deleted by admin" on public.profiles
  for delete using (public.is_admin());

-- ============================================================
-- Verrou de validation admin, sur fuel_events ET logbook_entries.
-- ============================================================
alter table public.fuel_events
  add column validated_at timestamptz,
  add column validated_by uuid references auth.users(id);

alter table public.logbook_entries
  add column validated_at timestamptz,
  add column validated_by uuid references auth.users(id);

-- ============================================================
-- VEHICLES / DRIVERS : lecture pour tout membre de la flotte, écriture admin only.
-- Remplace entièrement les anciennes policies "owner full access" (mono-utilisateur).
-- ============================================================
drop policy "owner full access" on public.vehicles;
create policy "fleet reads vehicles" on public.vehicles
  for select using (public.is_fleet_member());
create policy "admin inserts vehicles" on public.vehicles
  for insert with check (public.is_admin());
create policy "admin updates vehicles" on public.vehicles
  for update using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes vehicles" on public.vehicles
  for delete using (public.is_admin());

drop policy "owner full access" on public.drivers;
create policy "fleet reads drivers" on public.drivers
  for select using (public.is_fleet_member());
create policy "admin inserts drivers" on public.drivers
  for insert with check (public.is_admin());
create policy "admin updates drivers" on public.drivers
  for update using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes drivers" on public.drivers
  for delete using (public.is_admin());

-- ============================================================
-- FUEL_EVENTS : chacun voit/modifie/supprime le sien tant que non validé ; admin
-- voit/agit sur tout, sans restriction de validation.
-- ============================================================
drop policy "owner full access" on public.fuel_events;

create policy "read own fuel events or admin" on public.fuel_events
  for select using (owner_id = auth.uid() or public.is_admin());

create policy "insert own fuel events" on public.fuel_events
  for insert with check (owner_id = auth.uid() and public.is_fleet_member());

create policy "update own unvalidated fuel events or admin" on public.fuel_events
  for update
  using ((owner_id = auth.uid() and validated_at is null) or public.is_admin())
  with check ((owner_id = auth.uid() and validated_at is null) or public.is_admin());

create policy "delete own unvalidated fuel events or admin" on public.fuel_events
  for delete
  using ((owner_id = auth.uid() and validated_at is null) or public.is_admin());

-- ============================================================
-- LOGBOOK_ENTRIES : même patron que fuel_events.
-- ============================================================
drop policy "owner full access" on public.logbook_entries;

create policy "read own logbook entries or admin" on public.logbook_entries
  for select using (owner_id = auth.uid() or public.is_admin());

create policy "insert own logbook entries" on public.logbook_entries
  for insert with check (owner_id = auth.uid() and public.is_fleet_member());

create policy "update own unvalidated logbook entries or admin" on public.logbook_entries
  for update
  using ((owner_id = auth.uid() and validated_at is null) or public.is_admin())
  with check ((owner_id = auth.uid() and validated_at is null) or public.is_admin());

create policy "delete own unvalidated logbook entries or admin" on public.logbook_entries
  for delete
  using ((owner_id = auth.uid() and validated_at is null) or public.is_admin());

-- ============================================================
-- PHOTOS : même visibilité/modifiabilité que l'événement parent (jointure).
-- Suppression directe réservée à l'admin — VOIR NOTE dans le message de réponse au
-- sujet de son interaction avec ON DELETE CASCADE depuis fuel_events.
-- ============================================================
drop policy "owner full access via fuel_event" on public.photos;

create policy "read photos via parent fuel event" on public.photos
  for select using (
    exists (
      select 1 from public.fuel_events fe
      where fe.id = photos.fuel_event_id
        and (fe.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "write photos via parent fuel event" on public.photos
  for insert with check (
    exists (
      select 1 from public.fuel_events fe
      where fe.id = photos.fuel_event_id
        and ((fe.owner_id = auth.uid() and fe.validated_at is null) or public.is_admin())
    )
  );

create policy "update photos via parent fuel event" on public.photos
  for update
  using (
    exists (
      select 1 from public.fuel_events fe
      where fe.id = photos.fuel_event_id
        and ((fe.owner_id = auth.uid() and fe.validated_at is null) or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.fuel_events fe
      where fe.id = photos.fuel_event_id
        and ((fe.owner_id = auth.uid() and fe.validated_at is null) or public.is_admin())
    )
  );

create policy "delete photos admin only" on public.photos
  for delete using (public.is_admin());

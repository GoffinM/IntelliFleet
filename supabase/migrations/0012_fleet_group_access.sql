-- IntelliFleet — accès aux véhicules restreint par groupe de flotte.
--
-- Avant : "fleet reads vehicles" (0005) = is_fleet_member() seul — tout chauffeur
-- voyait TOUS les véhicules (privés, Rwanda, Burundi). Après : un chauffeur ne voit
-- que les véhicules des groupes qui lui sont accordés dans driver_fleet_access
-- (un compte peut avoir plusieurs groupes) ; l'admin voit tout. Un véhicule sans
-- groupe (fleet_group null) est invisible à tout chauffeur tant qu'il n'est pas
-- classé — repli sûr par défaut.
--
-- La table drivers (noms du champ "chauffeur" des formulaires) n'est volontairement
-- PAS touchée : elle reste lisible par tout membre de la flotte (0005).
--
-- AVANT de lancer cette migration : vérifier qu'aucun véhicule n'a un fleet_group
-- hors vocabulaire, sinon l'ajout de la contrainte échoue (et rien n'est appliqué) :
--   select fleet_group, count(*) from public.vehicles group by fleet_group;

-- ============================================================
-- a. Vocabulaire fermé des groupes : une faute de frappe rendrait un véhicule
--    invisible à tout chauffeur, sans erreur visible.
-- ============================================================
alter table public.vehicles
  add constraint vehicles_fleet_group_check
  check (fleet_group is null or fleet_group in ('SHER Rwanda', 'SHER Burundi', 'Privés'));

-- ============================================================
-- b. Groupes accordés à chaque compte (many-to-many). Admin only : un chauffeur n'a
--    jamais besoin de lire cette table, la vérification passe par
--    driver_has_group_access() (SECURITY DEFINER, ci-dessous).
-- ============================================================
create table public.driver_fleet_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fleet_group text not null
    check (fleet_group in ('SHER Rwanda', 'SHER Burundi', 'Privés')),
  created_at timestamptz not null default now(),
  unique (user_id, fleet_group)
);

alter table public.driver_fleet_access enable row level security;

create policy "admin reads fleet access" on public.driver_fleet_access
  for select using (public.is_admin());
create policy "admin inserts fleet access" on public.driver_fleet_access
  for insert with check (public.is_admin());
create policy "admin updates fleet access" on public.driver_fleet_access
  for update using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes fleet access" on public.driver_fleet_access
  for delete using (public.is_admin());

-- ============================================================
-- c. Même patron que is_admin()/is_fleet_member() (0005) : SECURITY DEFINER, pour
--    lire driver_fleet_access sans passer par sa RLS (admin only).
-- ============================================================
create or replace function public.driver_has_group_access(check_group text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.driver_fleet_access
    where user_id = auth.uid() and fleet_group = check_group
  );
$$;

-- Règle de visibilité d'UN véhicule, réutilisée ci-dessous par les policies de
-- saisie et par la vue des trajets ouverts (qui contourne la RLS de vehicles).
create or replace function public.can_access_vehicle(p_vehicle_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_admin() or exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id
      and v.fleet_group is not null
      and public.driver_has_group_access(v.fleet_group)
  );
$$;

-- ============================================================
-- d. VEHICLES : lecture restreinte par groupe (écriture inchangée, admin only).
-- ============================================================
drop policy "fleet reads vehicles" on public.vehicles;
create policy "admin or group member reads vehicles" on public.vehicles
  for select using (
    public.is_admin()
    or (fleet_group is not null and public.driver_has_group_access(fleet_group))
  );

-- ============================================================
-- e. Saisie : un chauffeur ne peut créer (ou déplacer) un plein/relevé que sur un
--    véhicule qu'il voit — sinon un UUID connu (ancien localStorage, appel API
--    direct) suffirait à saisir sur un véhicule masqué. Lecture de ses propres
--    saisies inchangée (0005), y compris sur un véhicule dont l'accès a été retiré.
-- ============================================================
drop policy "insert own fuel events" on public.fuel_events;
create policy "insert own fuel events" on public.fuel_events
  for insert with check (
    owner_id = auth.uid() and public.is_fleet_member() and public.can_access_vehicle(vehicle_id)
  );

drop policy "update own unvalidated fuel events or admin" on public.fuel_events;
create policy "update own unvalidated fuel events or admin" on public.fuel_events
  for update
  using ((owner_id = auth.uid() and validated_at is null) or public.is_admin())
  with check (
    (owner_id = auth.uid() and validated_at is null and public.can_access_vehicle(vehicle_id))
    or public.is_admin()
  );

drop policy "insert own logbook entries" on public.logbook_entries;
create policy "insert own logbook entries" on public.logbook_entries
  for insert with check (
    owner_id = auth.uid() and public.is_fleet_member() and public.can_access_vehicle(vehicle_id)
  );

drop policy "update own unvalidated logbook entries or admin" on public.logbook_entries;
create policy "update own unvalidated logbook entries or admin" on public.logbook_entries
  for update
  using ((owner_id = auth.uid() and validated_at is null) or public.is_admin())
  with check (
    (owner_id = auth.uid() and validated_at is null and public.can_access_vehicle(vehicle_id))
    or public.is_admin()
  );

-- ============================================================
-- f. Trajets ouverts des autres chauffeurs (0008) : la vue s'exécute avec les droits
--    de son propriétaire et échappe donc à la RLS de vehicles — sans ce filtre, un
--    chauffeur Burundi verrait encore les trajets ouverts de tous les véhicules.
--    Colonnes strictement identiques à 0008 (create or replace view l'exige).
-- ============================================================
create or replace view public.open_trips_other_drivers as
select
  le.id,
  le.vehicle_id,
  d.name as driver_name,
  le.event_date,
  le.km
from public.logbook_entries le
left join public.drivers d on d.id = le.driver_id
where le.close_km is null
  and le.owner_id <> auth.uid()
  and public.is_fleet_member()
  and public.can_access_vehicle(le.vehicle_id);

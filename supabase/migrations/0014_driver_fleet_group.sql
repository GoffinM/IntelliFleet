-- IntelliFleet — chauffeurs rattachés à un groupe de flotte, création en self-service.
--
-- drivers = liste de NOMS pour le champ "chauffeur" des formulaires (pas des comptes).
-- Désormais chaque nom appartient à un groupe (ou à aucun = "occasionnel", visible
-- sur tous les véhicules), et un chauffeur connecté peut en ajouter dans SES groupes.
-- Lecture de drivers inchangée (0005) : visible par tout membre de la flotte.
--
-- AVANT de lancer cette migration : l'index d'unicité (d) échoue si deux chauffeurs
-- ACTIFS portent déjà le même nom (sans tenir compte des majuscules). À ce stade
-- fleet_group vaut null partout, donc le contrôle porte sur le nom seul :
--   select lower(name), count(*) from public.drivers
--   where is_active group by lower(name) having count(*) > 1;

-- ============================================================
-- a. Groupe du chauffeur — même vocabulaire fermé que vehicles.fleet_group (0012).
-- ============================================================
alter table public.drivers
  add column fleet_group text
  check (fleet_group is null or fleet_group in ('SHER Rwanda', 'SHER Burundi', 'Privés'));

-- ============================================================
-- b. Création : admin (tout groupe, y compris occasionnel) OU membre de la flotte
--    dans un groupe qui lui est accordé. Jamais d'occasionnel créé par un non-admin.
-- ============================================================
drop policy "admin inserts drivers" on public.drivers;
create policy "admin or group member inserts drivers" on public.drivers
  for insert with check (
    public.is_admin()
    or (
      public.is_fleet_member()
      and fleet_group is not null
      and public.driver_has_group_access(fleet_group)
    )
  );

-- ============================================================
-- c. Groupes du compte connecté, pour l'écran "+ Chauffeur" : driver_fleet_access
--    reste lisible par l'admin seul (0012) ; cette fonction n'expose que les lignes
--    de l'appelant. Exacte même pour un groupe qui n'a encore aucun véhicule.
-- ============================================================
create or replace function public.my_fleet_groups()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select fleet_group from public.driver_fleet_access
  where user_id = auth.uid()
  order by fleet_group;
$$;

-- ============================================================
-- d. Pas deux chauffeurs actifs du même nom dans un même groupe (majuscules
--    ignorées), occasionnels compris : coalesce(fleet_group, '') car un index
--    unique considère chaque NULL comme distinct — sans lui, deux "Michel-Henri"
--    occasionnels passeraient. Un chauffeur désactivé libère son nom.
-- ============================================================
create unique index drivers_group_name_key
  on public.drivers (coalesce(fleet_group, ''), lower(name))
  where is_active;

-- Remplace l'unicité mono-utilisateur de 0001 (owner_id, name) : elle empêchait un
-- même compte de réutiliser un nom dans un AUTRE groupe, et un chauffeur désactivé
-- de libérer son nom — incompatible avec l'unicité par groupe ci-dessus.
drop index public.drivers_owner_name_key;

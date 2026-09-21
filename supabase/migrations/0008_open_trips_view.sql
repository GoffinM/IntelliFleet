-- IntelliFleet — Tranche 5 — accès rapide "Fermer un trajet" (trajets ouverts)

-- ============================================================
-- Vue en lecture seule exposant UNIQUEMENT id, vehicle_id, driver_name, event_date,
-- km des trajets ouverts (close_km is null) appartenant à un AUTRE compte que
-- l'appelant — jamais de commentaire, jamais de photo, jamais l'entrée de
-- l'appelant lui-même (déjà visible dans "Tes trajets ouverts" via une requête
-- directe sur logbook_entries, RLS existante).
--
-- Postgres ne permet pas d'attacher une policy RLS (CREATE POLICY) directement à
-- une vue — seules les tables ordinaires le supportent. Équivalent fonctionnel
-- retenu ici : la vue est définie sans security_invoker (comportement par défaut
-- de Postgres pour les vues), donc elle interroge logbook_entries avec les droits
-- du PROPRIÉTAIRE de la vue (le rôle postgres), qui échappe à la RLS de
-- logbook_entries (comportement standard : un propriétaire de table n'est pas
-- soumis à RLS sauf FORCE ROW LEVEL SECURITY, jamais activé sur cette table). La
-- restriction "membre de la flotte" + "jamais mes propres trajets" est donc
-- encodée directement dans le WHERE de la vue, pas dans une policy séparée.
-- logbook_entries elle-même garde sa policy actuelle strictement inchangée.
--
-- owner_id n'est volontairement PAS dans les colonnes exposées : c'est justement
-- ce qui permet à la vue de filtrer "pas à moi" (owner_id <> auth.uid()) sans
-- jamais révéler à qui chaque trajet appartient réellement — driver_id/driver_name
-- est un simple champ descriptif (peut différer du compte connecté), jamais
-- l'identité RLS réelle.
-- ============================================================
create view public.open_trips_other_drivers as
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
  and public.is_fleet_member();

grant select on public.open_trips_other_drivers to authenticated;
revoke all on public.open_trips_other_drivers from anon;

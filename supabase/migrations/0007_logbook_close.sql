-- IntelliFleet — Tranche 4 — relevé en deux étapes (ouverture/clôture de trajet)

-- ============================================================
-- LOGBOOK_ENTRIES : clôture optionnelle d'un trajet. Un relevé jamais clôturé
-- reste un relevé ponctuel, comportement inchangé (close_km/close_at restent
-- null). Aucune policy RLS nouvelle : clôturer n'est qu'un UPDATE de plus sur la
-- même ligne, déjà couvert par "update own unvalidated logbook entries or admin"
-- (0005_fleet_multi_user.sql) — exactement la règle voulue (propriétaire tant
-- que non validé, ou admin).
-- ============================================================
alter table public.logbook_entries
  add column close_km integer,
  add column close_at timestamptz;

alter table public.logbook_entries
  add constraint logbook_entries_close_km_after_km
  check (close_km is null or close_km >= km);

-- Les deux champs de clôture vont toujours ensemble : un close_km sans close_at
-- (ou l'inverse) ferait planter l'algorithme de segmentation de dashboard.js
-- (monthKey(null)) — bloqué aussi côté formulaire, mais protégé ici à la source.
alter table public.logbook_entries
  add constraint logbook_entries_close_km_close_at_together
  check ((close_km is null) = (close_at is null));

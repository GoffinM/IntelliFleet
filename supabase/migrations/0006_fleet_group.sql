-- IntelliFleet — Tranche 3 — regroupement de flotte (tableau de bord d'analyse)

-- ============================================================
-- VEHICLES : étiquette de groupe libre (texte, pas de liste fermée), saisie par
-- l'admin à la création du véhicule. Sert de clé de regroupement pour le tableau
-- de bord ; nullable, aucune valeur par défaut imposée.
-- ============================================================
alter table public.vehicles
  add column fleet_group text;

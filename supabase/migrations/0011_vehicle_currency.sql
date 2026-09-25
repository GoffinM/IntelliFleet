-- IntelliFleet — parc mixte Rwanda/Burundi : devise par véhicule.
--
-- Les montants (fuel_events.amount, unit_price) restent des entiers sans sous-unité,
-- exprimés dans la devise du véhicule concerné. Aucune conversion : l'app ne doit
-- jamais additionner des montants de devises différentes.

alter table public.vehicles
  add column currency text not null default 'RWF'
  check (currency in ('RWF', 'BIF'));

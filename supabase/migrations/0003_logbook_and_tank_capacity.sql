-- IntelliFleet — Tranche 1.1 — volume réservoir + relevés de compteur (logbook léger)

-- ============================================================
-- VEHICLES : volume du réservoir (stockage seul, pas de contrôle bloquant pour l'instant)
-- ============================================================
alter table public.vehicles
  add column tank_capacity_liters numeric;

alter table public.vehicles
  add constraint vehicles_tank_capacity_positive
  check (tank_capacity_liters is null or tank_capacity_liters > 0);

-- ============================================================
-- LOGBOOK_ENTRIES : relevé de compteur simple, sans type d'événement
-- ============================================================
create table public.logbook_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete set null,   -- nullable : chauffeur optionnel
  km integer not null check (km >= 0),
  event_date date not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index logbook_entries_vehicle_date_idx on public.logbook_entries(vehicle_id, event_date desc);
create index logbook_entries_driver_idx on public.logbook_entries(driver_id);

alter table public.logbook_entries enable row level security;
create policy "owner full access" on public.logbook_entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============================================================
-- Extension de recompute_vehicle_current_km() pour inclure logbook_entries
-- (l'emplacement était déjà anticipé par un commentaire dans 0001_init.sql).
-- create or replace ne casse pas les triggers existants sur fuel_events/vehicles,
-- qui continuent de pointer vers cette même fonction par son nom.
-- ============================================================
create or replace function public.recompute_vehicle_current_km(p_vehicle_id uuid)
returns void language plpgsql as $$
begin
  update public.vehicles v
  set current_km = greatest(
        v.initial_km,
        coalesce((select max(km) from public.fuel_events fe where fe.vehicle_id = p_vehicle_id), 0),
        coalesce((select max(km) from public.logbook_entries le where le.vehicle_id = p_vehicle_id), 0)
      ),
      updated_at = now()
  where v.id = p_vehicle_id;
end;
$$;

-- Trigger sur logbook_entries, même patron défensif que fuel_events_recompute_km
-- (recalcule l'ancien ET le nouveau véhicule si vehicle_id change).
create or replace function public.trg_logbook_entries_recompute_km()
returns trigger language plpgsql as $$
begin
  perform public.recompute_vehicle_current_km(coalesce(new.vehicle_id, old.vehicle_id));
  if tg_op = 'UPDATE' and old.vehicle_id is distinct from new.vehicle_id then
    perform public.recompute_vehicle_current_km(old.vehicle_id);
  end if;
  return null;
end;
$$;

create trigger logbook_entries_recompute_km
after insert or update of km, vehicle_id or delete on public.logbook_entries
for each row execute function public.trg_logbook_entries_recompute_km();

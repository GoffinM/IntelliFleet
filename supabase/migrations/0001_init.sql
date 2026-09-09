-- IntelliFleet — Tranche 1 — schéma initial
-- vehicles, drivers, fuel_events, photos + triggers de cohérence + RLS + storage

-- ============================================================
-- VEHICLES
-- ============================================================
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,                      -- nom convivial (ex: "RAV4 Mimi")
  plate text not null,
  make text not null,
  model text not null,
  year smallint,
  initial_km integer not null default 0,   -- référence figée à la création du véhicule
  current_km integer not null default 0,   -- maintenu par trigger, jamais édité à la main
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vehicles_owner_plate_key on public.vehicles(owner_id, plate);
create unique index vehicles_owner_name_key on public.vehicles(owner_id, name);

-- ============================================================
-- DRIVERS (référence simple, pas un compte utilisateur)
-- ============================================================
create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index drivers_owner_name_key on public.drivers(owner_id, name);

-- ============================================================
-- FUEL_EVENTS
-- ============================================================
create table public.fuel_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete set null,   -- nullable : chauffeur optionnel
  event_date date not null,
  km integer not null check (km >= 0),
  liters numeric(6,2) not null check (liters > 0),
  unit_price integer not null check (unit_price > 0),   -- RWF/L, pas de sous-unité
  amount integer not null check (amount > 0),           -- RWF, pas de sous-unité
  station text,
  notes text,
  is_complete boolean not null default false,           -- maintenu par trigger (4/4 photos)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fuel_events_vehicle_date_idx on public.fuel_events(vehicle_id, event_date desc);
create index fuel_events_driver_idx on public.fuel_events(driver_id);

-- ============================================================
-- PHOTOS
-- ============================================================
create type public.fuel_photo_type as enum ('vehicle_plate', 'odometer', 'pump', 'receipt');

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  fuel_event_id uuid not null references public.fuel_events(id) on delete cascade,
  type public.fuel_photo_type not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (fuel_event_id, type)   -- une seule photo par type et par événement (upsert sur retake)
);

-- ============================================================
-- Trigger : recalcul current_km = MAX(initial_km, fuel_events.km)
-- Encapsulé dans une fonction pour être étendu en Tranche 1.5 (logbook_entries) sans toucher aux triggers.
-- ============================================================
create or replace function public.recompute_vehicle_current_km(p_vehicle_id uuid)
returns void language plpgsql as $$
begin
  update public.vehicles v
  set current_km = greatest(
        v.initial_km,
        coalesce((select max(km) from public.fuel_events fe where fe.vehicle_id = p_vehicle_id), 0)
        -- Tranche 1.5 : ajouter ici coalesce((select max(km) from public.logbook_entries ...), 0)
      ),
      updated_at = now()
  where v.id = p_vehicle_id;
end;
$$;

create or replace function public.trg_fuel_events_recompute_km()
returns trigger language plpgsql as $$
begin
  perform public.recompute_vehicle_current_km(coalesce(new.vehicle_id, old.vehicle_id));
  if tg_op = 'UPDATE' and old.vehicle_id is distinct from new.vehicle_id then
    perform public.recompute_vehicle_current_km(old.vehicle_id);
  end if;
  return null;
end;
$$;

create trigger fuel_events_recompute_km
after insert or update of km, vehicle_id or delete on public.fuel_events
for each row execute function public.trg_fuel_events_recompute_km();

-- Correctif : current_km doit aussi suivre initial_km indépendamment des fuel_events
-- (testé : sans ceci, un véhicule neuf reste à current_km=0 tant qu'aucun plein n'existe).
create or replace function public.trg_vehicles_set_current_km_on_insert()
returns trigger language plpgsql as $$
begin
  new.current_km := new.initial_km;
  return new;
end;
$$;

create trigger vehicles_set_current_km_on_insert
before insert on public.vehicles
for each row execute function public.trg_vehicles_set_current_km_on_insert();

create or replace function public.trg_vehicles_recompute_on_initial_km_change()
returns trigger language plpgsql as $$
begin
  if new.initial_km is distinct from old.initial_km then
    perform public.recompute_vehicle_current_km(new.id);
  end if;
  return null;
end;
$$;

create trigger vehicles_recompute_on_initial_km_change
after update of initial_km on public.vehicles
for each row execute function public.trg_vehicles_recompute_on_initial_km_change();

-- ============================================================
-- Trigger : is_complete sur fuel_events = (4 photos présentes)
-- ============================================================
create or replace function public.recompute_fuel_event_is_complete(p_fuel_event_id uuid)
returns void language plpgsql as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.photos where fuel_event_id = p_fuel_event_id;
  update public.fuel_events set is_complete = (v_count = 4), updated_at = now()
  where id = p_fuel_event_id;
end;
$$;

create or replace function public.trg_photos_recompute_complete()
returns trigger language plpgsql as $$
begin
  perform public.recompute_fuel_event_is_complete(coalesce(new.fuel_event_id, old.fuel_event_id));
  if tg_op = 'UPDATE' and old.fuel_event_id is distinct from new.fuel_event_id then
    perform public.recompute_fuel_event_is_complete(old.fuel_event_id);
  end if;
  return null;
end;
$$;

-- Couvre aussi UPDATE : le remplacement d'une photo se fait par upsert
-- (insert ... on conflict (fuel_event_id, type) do update), qui peut emprunter
-- le chemin UPDATE de Postgres sur un conflit. is_complete doit rester correct
-- quel que soit le chemin DML emprunté pour arriver à 4 lignes présentes.
create trigger photos_recompute_complete
after insert or update or delete on public.photos
for each row execute function public.trg_photos_recompute_complete();

-- ============================================================
-- RLS
-- ============================================================
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.fuel_events enable row level security;
alter table public.photos enable row level security;

create policy "owner full access" on public.vehicles
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner full access" on public.drivers
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner full access" on public.fuel_events
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner full access via fuel_event" on public.photos
  for all using (exists (select 1 from public.fuel_events fe where fe.id = photos.fuel_event_id and fe.owner_id = auth.uid()))
  with check (exists (select 1 from public.fuel_events fe where fe.id = photos.fuel_event_id and fe.owner_id = auth.uid()));

-- ============================================================
-- Storage bucket privé, chemin {owner_id}/{fuel_event_id}/{type}.jpg
-- ============================================================
insert into storage.buckets (id, name, public) values ('fuel-photos', 'fuel-photos', false)
on conflict (id) do nothing;

create policy "owner read own photos" on storage.objects
  for select using (bucket_id = 'fuel-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner write own photos" on storage.objects
  for insert with check (bucket_id = 'fuel-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner update own photos" on storage.objects
  for update using (bucket_id = 'fuel-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fuel-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner delete own photos" on storage.objects
  for delete using (bucket_id = 'fuel-photos' and (storage.foldername(name))[1] = auth.uid()::text);

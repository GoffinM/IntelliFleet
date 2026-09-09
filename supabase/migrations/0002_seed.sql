-- IntelliFleet — seed des 2 véhicules et chauffeurs
-- owner_id fourni explicitement (auth.uid() est NULL depuis l'éditeur SQL / une connexion admin directe).

insert into public.vehicles (owner_id, name, plate, make, model, year, initial_km)
values
  ('22617fb7-75b8-413f-a8eb-22aa6681718d', 'RAV4 Mimi', 'RAD927P', 'Toyota', 'RAV4',         2003, 150000),
  ('22617fb7-75b8-413f-a8eb-22aa6681718d', 'LC Mich',   'RAF538V', 'Toyota', 'Land Cruiser',  2009, 180000)
on conflict (owner_id, plate) do nothing;

insert into public.drivers (owner_id, name)
values
  ('22617fb7-75b8-413f-a8eb-22aa6681718d', 'Mimi'),
  ('22617fb7-75b8-413f-a8eb-22aa6681718d', 'Mich')
on conflict (owner_id, name) do nothing;

-- IntelliFleet — accès admin aux photos des autres comptes (Storage).
--
-- Constat (pg_policies, prod) : les 8 policies de storage.objects (0001 fuel-photos,
-- 0004 logbook-photos) exigent toutes (storage.foldername(name))[1] = auth.uid(),
-- sans exception admin. Conséquences pour l'admin sur une photo d'un autre compte :
--   - createSignedUrl → "Object not found" (la RLS masque l'objet) : miniatures du
--     Tableau de bord et écrans d'édition en erreur ;
--   - "Supprimer les photos" → storage.remove() ne supprime rien, SANS erreur, puis
--     la référence en base est effacée : fichier orphelin dans le bucket.
--
-- Correctif : policies admin SUPPLÉMENTAIRES pour SELECT / UPDATE / DELETE. Les
-- policies permissives d'une même opération se combinent en OR : on obtient
-- "propriétaire OU admin" sans toucher aux règles propriétaire existantes. Pas
-- d'INSERT admin : un admin n'uploade jamais à la place d'un chauffeur.

-- ============================================================
-- fuel-photos
-- ============================================================
create policy "admin read all fuel photos" on storage.objects
  for select using (bucket_id = 'fuel-photos' and public.is_admin());
create policy "admin update all fuel photos" on storage.objects
  for update using (bucket_id = 'fuel-photos' and public.is_admin())
  with check (bucket_id = 'fuel-photos' and public.is_admin());
create policy "admin delete all fuel photos" on storage.objects
  for delete using (bucket_id = 'fuel-photos' and public.is_admin());

-- ============================================================
-- logbook-photos
-- ============================================================
create policy "admin read all logbook photos" on storage.objects
  for select using (bucket_id = 'logbook-photos' and public.is_admin());
create policy "admin update all logbook photos" on storage.objects
  for update using (bucket_id = 'logbook-photos' and public.is_admin())
  with check (bucket_id = 'logbook-photos' and public.is_admin());
create policy "admin delete all logbook photos" on storage.objects
  for delete using (bucket_id = 'logbook-photos' and public.is_admin());

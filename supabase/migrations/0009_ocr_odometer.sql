-- IntelliFleet — Tranche 6 — OCR Claude Vision sur les photos de compteur (écran Validation)

-- ============================================================
-- FUEL_EVENTS / LOGBOOK_ENTRIES : résultat de la lecture automatique du
-- kilométrage (Edge Function analyze-odometer) sur la photo compteur. Aucune
-- policy RLS nouvelle : c'est un UPDATE de plus sur des lignes déjà accessibles
-- en écriture à l'admin via is_admin() dans les policies UPDATE existantes
-- (0005_fleet_multi_user.sql) — confirmé, pas supposé.
-- ============================================================
alter table public.fuel_events
  add column ocr_km integer,
  add column ocr_confidence text,
  add column ocr_raw_text text,
  add column ocr_analyzed_at timestamptz;

alter table public.logbook_entries
  add column ocr_km integer,
  add column ocr_confidence text,
  add column ocr_raw_text text,
  add column ocr_analyzed_at timestamptz;

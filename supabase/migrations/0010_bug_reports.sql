-- Chantier "Signaler un bug" : table de signalement + contexte technique auto-capturé.
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description text not null,
  screen_hash text,
  role text,
  browser_info text,
  app_version text,
  created_at timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

create policy "bug_reports_insert_own" on public.bug_reports
  for insert
  with check (owner_id = auth.uid());

create policy "bug_reports_select_admin" on public.bug_reports
  for select
  using (public.is_admin());

create policy "bug_reports_delete_admin" on public.bug_reports
  for delete
  using (public.is_admin());

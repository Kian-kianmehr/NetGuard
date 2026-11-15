-- Candidate domains from the public Citizen Lab Iran test list.
-- These are test targets, not confirmed blocked domains.
create table if not exists public.censorship_test_domains (
  domain text primary key,
  input text not null,
  category_code text not null,
  category_description text not null default '',
  source_url text not null,
  updated_at timestamptz not null default now()
);
create index if not exists censorship_test_domains_category_idx
  on public.censorship_test_domains (category_code);

alter table public.censorship_test_domains enable row level security;
drop policy if exists "public read censorship test domains" on public.censorship_test_domains;
create policy "public read censorship test domains"
  on public.censorship_test_domains
  for select to anon, authenticated
  using (true);
grant select on public.censorship_test_domains to anon, authenticated;
grant all on public.censorship_test_domains to service_role;

alter table public.censorship_sync_runs
  add column if not exists test_list_records_received integer not null default 0,
  add column if not exists test_list_error_code text;

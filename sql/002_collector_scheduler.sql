create schema if not exists net;
create extension if not exists pg_net with schema net;

create table if not exists public.netguard_collector_credentials (
  name text primary key check (name = 'ioda_collector'),
  token_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.netguard_collector_credentials enable row level security;
revoke all on table public.netguard_collector_credentials from public, anon, authenticated;
grant select on table public.netguard_collector_credentials to service_role;

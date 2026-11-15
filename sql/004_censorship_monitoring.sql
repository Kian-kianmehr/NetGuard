create table if not exists public.censorship_measurements (
  measurement_id text primary key,
  domain text not null,
  input text not null,
  classification text not null check (classification in ('confirmed', 'anomaly')),
  measurement_start_time timestamptz not null,
  probe_asn bigint,
  category_code text,
  report_id text,
  test_name text not null default 'web_connectivity',
  created_at timestamptz not null default now()
);

create index if not exists censorship_measurements_domain_time_idx
  on public.censorship_measurements (domain, measurement_start_time desc);
create index if not exists censorship_measurements_time_idx
  on public.censorship_measurements (measurement_start_time desc);

create table if not exists public.censorship_sync_runs (
  id uuid primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('success', 'partial', 'error')),
  records_received integer not null default 0,
  error_code text
);

create index if not exists censorship_sync_runs_started_idx
  on public.censorship_sync_runs (started_at desc);

alter table public.censorship_measurements enable row level security;
alter table public.censorship_sync_runs enable row level security;

drop policy if exists "public read censorship measurements" on public.censorship_measurements;
create policy "public read censorship measurements" on public.censorship_measurements
  for select to anon, authenticated using (true);

drop policy if exists "public read censorship sync runs" on public.censorship_sync_runs;
create policy "public read censorship sync runs" on public.censorship_sync_runs
  for select to anon, authenticated using (true);

grant select on public.censorship_measurements, public.censorship_sync_runs to anon, authenticated;
grant all on public.censorship_measurements, public.censorship_sync_runs to service_role;

create or replace view public.censored_domains with (security_invoker=true) as
select
  domain,
  bool_or(classification = 'confirmed') as confirmed_blocked,
  count(*) filter (where classification = 'confirmed')::integer as confirmed_measurements,
  count(*) filter (where classification = 'anomaly')::integer as anomaly_measurements,
  count(distinct probe_asn) filter (where probe_asn is not null)::integer as probe_networks,
  min(measurement_start_time) as first_observed_at,
  max(measurement_start_time) as last_observed_at,
  max(category_code) as category_code
from public.censorship_measurements
where measurement_start_time >= now() - interval '90 days'
group by domain;

grant select on public.censored_domains to anon, authenticated;

create schema if not exists net;
create extension if not exists pg_net with schema net;
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'netguard-ooni-censorship'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'netguard-ooni-censorship',
    '15 */6 * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'netguard_project_url'
        ) || '/functions/v1/netguard-censorship-collector',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'netguard_publishable_key'
          ),
          'x-netguard-token', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'netguard_collector_token'
          )
        ),
        body := jsonb_build_object('triggered_at', now()),
        timeout_milliseconds := 30000
      );
    $job$
  );
end
$$;
-- Persist provider status snapshots and run all collectors on a ten-minute cadence.
create table if not exists public.netguard_snapshots (
  dataset_key text primary key,
  payload jsonb not null,
  collected_at timestamptz not null default now(),
  status text not null default 'success' check (status in ('success','partial','error')),
  source_count integer not null default 0,
  error_code text
);
create index if not exists netguard_snapshots_collected_idx
  on public.netguard_snapshots (collected_at desc);
alter table public.netguard_snapshots enable row level security;
drop policy if exists "public read netguard snapshots" on public.netguard_snapshots;
create policy "public read netguard snapshots" on public.netguard_snapshots
  for select to anon, authenticated using (true);
grant select on public.netguard_snapshots to anon, authenticated;
grant all on public.netguard_snapshots to service_role;

create schema if not exists net;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema net;
do $$
declare j bigint;
begin
  for j in select jobid from cron.job
    where jobname in ('netguard-ioda-collector','netguard-ooni-censorship','netguard-provider-status')
  loop
    perform cron.unschedule(j);
  end loop;
  perform cron.schedule(
    'netguard-ioda-collector','*/10 * * * *',
    $job$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='netguard_project_url') || '/functions/v1/netguard-collector',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='netguard_publishable_key'),
        'x-netguard-token',(select decrypted_secret from vault.decrypted_secrets where name='netguard_collector_token')),
      body := jsonb_build_object('triggered_at',now()), timeout_milliseconds := 30000
    );$job$
  );
  perform cron.schedule(
    'netguard-ooni-censorship','*/10 * * * *',
    $job$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='netguard_project_url') || '/functions/v1/netguard-censorship-collector',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='netguard_publishable_key'),
        'x-netguard-token',(select decrypted_secret from vault.decrypted_secrets where name='netguard_collector_token')),
      body := jsonb_build_object('triggered_at',now()), timeout_milliseconds := 90000
    );$job$
  );
  perform cron.schedule(
    'netguard-provider-status','*/10 * * * *',
    $job$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='netguard_project_url') || '/functions/v1/netguard-provider-collector',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='netguard_publishable_key'),
        'x-netguard-token',(select decrypted_secret from vault.decrypted_secrets where name='netguard_collector_token')),
      body := jsonb_build_object('triggered_at',now()), timeout_milliseconds := 30000
    );$job$
  );
end $$;

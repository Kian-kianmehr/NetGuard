create table if not exists public.sources (
  source_id text primary key,
  provider text not null,
  signal text not null,
  display_name text not null,
  unit text not null,
  description text not null default '',
  source_url text not null,
  geographic_scope text not null default 'country',
  expected_interval_seconds integer not null default 300 check (expected_interval_seconds > 0),
  stale_after_seconds integer not null default 1800 check (stale_after_seconds > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.collector_runs (
  id uuid primary key,
  source_id text not null references public.sources(source_id) on delete restrict,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('success','no_data','error')),
  records_received integer not null default 0,
  records_upserted integer not null default 0,
  duration_ms integer not null default 0,
  error_code text,
  error_message text,
  collector_version text not null
);

create table if not exists public.observations (
  id bigint generated always as identity primary key,
  source_id text not null references public.sources(source_id) on delete restrict,
  observed_at timestamptz not null,
  collected_at timestamptz not null,
  value double precision not null check (
    value >= 0 and value <> 'Infinity'::float8 and value <> 'NaN'::float8
  ),
  unit text not null,
  geographic_scope text not null,
  quality text not null default 'valid',
  external_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  unique (source_id, observed_at)
);

create index if not exists observations_observed_idx on public.observations (observed_at desc);
create index if not exists observations_source_time_idx on public.observations (source_id, observed_at desc);
create index if not exists collector_runs_source_time_idx on public.collector_runs (source_id, started_at desc);

insert into public.sources (
  source_id, provider, signal, display_name, unit, description, source_url,
  geographic_scope, expected_interval_seconds, stale_after_seconds
) values
('ioda:IR:bgp','IODA','bgp','دیدپذیری BGP','Visible IPv4 /24 networks',
 'شبکه‌های IPv4 قابل مشاهده از مسیر BGP؛ نمایندهٔ تجربهٔ همهٔ کاربران نیست.',
 'https://api.ioda.inetintel.cc.gatech.edu/v2/docs','country',300,1800),
('ioda:IR:ping-slash24','IODA','ping-slash24','پایش فعال شبکه','Reachable IPv4 /24 networks',
 'سیگنال probe فعال IODA؛ نتیجهٔ یک نقطه به همهٔ کاربران تعمیم داده نمی‌شود.',
 'https://api.ioda.inetintel.cc.gatech.edu/v2/docs','country',300,1800),
('ioda:IR:merit-nt','IODA','merit-nt','تلسکوپ شبکه','Unique source IPs',
 'مشاهدات تلسکوپ شبکهٔ Merit؛ تغییر آن به‌تنهایی علت اختلال را اثبات نمی‌کند.',
 'https://api.ioda.inetintel.cc.gatech.edu/v2/docs','country',300,7200)
on conflict (source_id) do update set
  provider=excluded.provider, signal=excluded.signal, display_name=excluded.display_name,
  unit=excluded.unit, description=excluded.description, source_url=excluded.source_url,
  geographic_scope=excluded.geographic_scope,
  expected_interval_seconds=excluded.expected_interval_seconds,
  stale_after_seconds=excluded.stale_after_seconds;

alter table public.sources enable row level security;
alter table public.collector_runs enable row level security;
alter table public.observations enable row level security;

drop policy if exists "public read enabled sources" on public.sources;
create policy "public read enabled sources" on public.sources
  for select to anon, authenticated using (enabled);
drop policy if exists "public read collector runs" on public.collector_runs;
create policy "public read collector runs" on public.collector_runs
  for select to anon, authenticated using (true);
drop policy if exists "public read observations" on public.observations;
create policy "public read observations" on public.observations
  for select to anon, authenticated using (true);

grant select on public.sources, public.collector_runs, public.observations to anon, authenticated;
grant all on public.sources, public.collector_runs, public.observations to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace view public.dashboard_sources with (security_invoker=true) as
select s.source_id, s.provider, s.signal, s.display_name, s.unit, s.description, s.source_url,
       latest.observed_at as last_observed_at,
       latest.collected_at as last_collected_at,
       latest.value as latest_value,
       case when latest.observed_at is null then null
            else extract(epoch from (now()-latest.observed_at))::bigint end as observation_age_seconds,
       run.started_at as last_run_started_at,
       run.status as last_run_status,
       case
         when latest.observed_at is null then 'unknown'
         when now()-latest.observed_at > make_interval(secs=>s.stale_after_seconds) then 'stale'
         when run.status='error' then 'degraded'
         when run.status is null then 'unknown'
         else 'fresh'
       end as freshness_status
from public.sources s
left join lateral (
  select o.observed_at,o.collected_at,o.value from public.observations o
  where o.source_id=s.source_id order by o.observed_at desc limit 1
) latest on true
left join lateral (
  select r.started_at,r.status from public.collector_runs r
  where r.source_id=s.source_id order by r.started_at desc limit 1
) run on true
where s.enabled;

create or replace view public.dashboard_observations with (security_invoker=true) as
select o.source_id,s.display_name,o.observed_at,o.collected_at,o.value,o.unit,
       o.geographic_scope,o.quality
from public.observations o join public.sources s using(source_id)
where s.enabled;

grant select on public.dashboard_sources, public.dashboard_observations to anon, authenticated;

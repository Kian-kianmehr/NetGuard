-- Improve IODA source cadence metadata and expose operational quality in the dashboard.
-- BGP and Merit are sampled at roughly five minutes; active Ping at roughly ten minutes.
update public.sources
set expected_interval_seconds = 600,
    stale_after_seconds = 2400
where source_id = 'ioda:IR:ping-slash24';

create or replace view public.dashboard_sources
with (security_invoker = true) as
select
  s.source_id,
  s.provider,
  s.signal,
  s.display_name,
  s.unit,
  s.description,
  s.source_url,
  latest.observed_at as last_observed_at,
  latest.collected_at as last_collected_at,
  latest.value as latest_value,
  case
    when latest.observed_at is null then null
    else extract(epoch from (now() - latest.observed_at))::bigint
  end as observation_age_seconds,
  run.started_at as last_run_started_at,
  run.status as last_run_status,
  case
    when latest.observed_at is null and run.status in ('error', 'no_data') then 'degraded'
    when latest.observed_at is null then 'unknown'
    when now() - latest.observed_at > make_interval(secs => s.stale_after_seconds::double precision) then 'stale'
    when run.status in ('error', 'no_data') then 'degraded'
    when run.status is null then 'unknown'
    else 'fresh'
  end as freshness_status,
  s.expected_interval_seconds,
  s.stale_after_seconds,
  run.error_code as last_run_error_code,
  run.duration_ms as last_run_duration_ms,
  run.records_received as last_run_records_received
from public.sources s
left join lateral (
  select o.observed_at, o.collected_at, o.value
  from public.observations o
  where o.source_id = s.source_id
  order by o.observed_at desc
  limit 1
) latest on true
left join lateral (
  select r.started_at, r.status, r.error_code, r.duration_ms, r.records_received
  from public.collector_runs r
  where r.source_id = s.source_id
  order by r.started_at desc
  limit 1
) run on true
where s.enabled;

grant select on public.dashboard_sources to anon, authenticated;

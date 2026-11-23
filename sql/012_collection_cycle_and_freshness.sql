-- NetGuard collection and AI cycle: 30-minute collection, 30-minute forecast, 60-minute packet validity.
-- Freshness is measured from the last successful collection, not the upstream observed_at.

update public.sources
set stale_after_seconds = 3600
where source_id in ('ioda:IR:bgp', 'ioda:IR:ping-slash24', 'ioda:IR:merit-nt');

create or replace view public.dashboard_sources with (security_invoker = true) as
select
  s.source_id, s.provider, s.signal, s.display_name, s.unit, s.description, s.source_url,
  latest.observed_at as last_observed_at,
  latest.collected_at as last_collected_at,
  latest.value as latest_value,
  case when latest.observed_at is null then null
       else extract(epoch from (now() - latest.observed_at))::bigint end as observation_age_seconds,
  run.started_at as last_run_started_at,
  run.status as last_run_status,
  case
    when latest.collected_at is null and run.status in ('error','no_data') then 'degraded'
    when latest.collected_at is null then 'unknown'
    when now() - latest.collected_at > make_interval(secs => s.stale_after_seconds::double precision) then 'stale'
    when run.status is null then 'unknown'
    else 'fresh'
  end as freshness_status,
  s.expected_interval_seconds,
  s.stale_after_seconds,
  run.error_code as last_run_error_code,
  run.duration_ms as last_run_duration_ms,
  run.records_received as last_run_records_received,
  case when latest.collected_at is null then null
       else extract(epoch from (now() - latest.collected_at))::bigint end as collection_age_seconds
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

-- Recreate only the three NetGuard cycle jobs. Other data-source schedules stay untouched.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job
    where jobname in (
      'netguard-ioda-collector',
      'netguard-aggregate-snapshots',
      'netguard-ai-analysis-worker'
    )
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'netguard-ioda-collector',
    '*/30 * * * *',
    $collector$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'netguard_project_url')
          || '/functions/v1/netguard-collector',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'netguard_publishable_key'),
          'x-netguard-token', (select decrypted_secret from vault.decrypted_secrets where name = 'netguard_collector_token')
        ),
        body := jsonb_build_object('triggered_at', now()),
        timeout_milliseconds := 30000
      );
    $collector$
  );

  perform cron.schedule(
    'netguard-aggregate-snapshots',
    '2,32 * * * *',
    $aggregate$
      select net.http_post(
        url := 'https://netguard-api-oan9.onrender.com/internal/collect-snapshots',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-netguard-token', (select decrypted_secret from vault.decrypted_secrets where name = 'netguard_collector_token')
        ),
        body := jsonb_build_object('triggered_at', now()),
        timeout_milliseconds := 120000
      );
    $aggregate$
  );

  perform cron.schedule(
    'netguard-ai-analysis-worker',
    '4,34 * * * *',
    $analysis$
      select net.http_post(
        url := 'https://netguard-api-oan9.onrender.com/internal/analyze-dashboard-cycle',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-netguard-token', (select decrypted_secret from vault.decrypted_secrets where name = 'netguard_collector_token')
        ),
        body := jsonb_build_object('triggered_at', now()),
        timeout_milliseconds := 120000
      );
    $analysis$
  );
end
$$;

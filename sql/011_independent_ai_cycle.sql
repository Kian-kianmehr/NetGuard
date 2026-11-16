-- Separate the dashboard data stage from the AI execution/publication cycle.
-- The public API keeps reading the previous successful dashboard snapshots until
-- all three windows for the new cycle can be published in one transaction.

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
       end as freshness_status,
       s.expected_interval_seconds,
       s.stale_after_seconds
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

create or replace function public.netguard_save_snapshot(
  p_token text,
  p_dataset_key text,
  p_payload jsonb,
  p_status text default 'success',
  p_source_count integer default 0,
  p_error_code text default null
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  expected_hash text;
  saved_at timestamptz := now();
begin
  if p_dataset_key not in (
    'dashboard_24','dashboard_72','dashboard_168','dashboard_staging',
    'censorship','providers_status','iran_datacenters'
  ) then
    raise exception 'invalid_snapshot_dataset';
  end if;
  if p_status not in ('success','partial','error') then
    raise exception 'invalid_snapshot_status';
  end if;
  if p_token is null or length(p_token) < 40 then
    raise exception 'unauthorized';
  end if;
  select token_hash into expected_hash
  from public.netguard_collector_credentials
  where name = 'ioda_collector';
  if expected_hash is null
     or encode(extensions.digest(p_token, 'sha256'), 'hex') <> expected_hash then
    raise exception 'unauthorized';
  end if;

  insert into public.netguard_snapshots(
    dataset_key,payload,collected_at,status,source_count,error_code
  ) values (
    p_dataset_key,coalesce(p_payload,'{}'::jsonb),saved_at,p_status,
    greatest(coalesce(p_source_count,0),0),p_error_code
  )
  on conflict (dataset_key) do update set
    payload=excluded.payload,collected_at=excluded.collected_at,
    status=excluded.status,source_count=excluded.source_count,error_code=excluded.error_code;

  insert into public.netguard_snapshot_runs(dataset_key,collected_at,status,source_count,error_code)
  values (p_dataset_key,saved_at,p_status,greatest(coalesce(p_source_count,0),0),p_error_code);
  return true;
end;
$$;

create or replace function public.netguard_publish_dashboard_cycle(
  p_token text,
  p_cycle_id text,
  p_dashboard_24 jsonb,
  p_dashboard_72 jsonb,
  p_dashboard_168 jsonb,
  p_source_count integer default 0
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  expected_hash text;
  saved_at timestamptz := now();
begin
  if p_token is null or length(p_token) < 40 then
    raise exception 'unauthorized';
  end if;
  select token_hash into expected_hash
  from public.netguard_collector_credentials
  where name = 'ioda_collector';
  if expected_hash is null
     or encode(extensions.digest(p_token, 'sha256'), 'hex') <> expected_hash then
    raise exception 'unauthorized';
  end if;

  if p_cycle_id is null or length(p_cycle_id) < 8 then
    raise exception 'invalid_cycle_id';
  end if;
  if not exists (
    select 1 from public.netguard_snapshots
    where dataset_key = 'dashboard_staging'
      and status in ('success','partial')
      and payload->>'cycle_id' = p_cycle_id
  ) then
    raise exception 'dashboard_cycle_not_staged';
  end if;
  if (p_dashboard_24->>'cycle_id') is distinct from p_cycle_id
     or (p_dashboard_72->>'cycle_id') is distinct from p_cycle_id
     or (p_dashboard_168->>'cycle_id') is distinct from p_cycle_id
     or (p_dashboard_24->>'analysis_cycle_id') is distinct from p_cycle_id
     or (p_dashboard_72->>'analysis_cycle_id') is distinct from p_cycle_id
     or (p_dashboard_168->>'analysis_cycle_id') is distinct from p_cycle_id then
    raise exception 'dashboard_cycle_mismatch';
  end if;

  if exists (
    select 1 from public.netguard_snapshots
    where dataset_key = 'dashboard_24'
      and payload->>'cycle_id' = p_cycle_id
  ) then
    return true;
  end if;

  insert into public.netguard_snapshots(
    dataset_key,payload,collected_at,status,source_count,error_code
  ) values
    ('dashboard_24',coalesce(p_dashboard_24,'{}'::jsonb),saved_at,'success',
     greatest(coalesce(p_source_count,0),0),null),
    ('dashboard_72',coalesce(p_dashboard_72,'{}'::jsonb),saved_at,'success',
     greatest(coalesce(p_source_count,0),0),null),
    ('dashboard_168',coalesce(p_dashboard_168,'{}'::jsonb),saved_at,'success',
     greatest(coalesce(p_source_count,0),0),null)
  on conflict (dataset_key) do update set
    payload=excluded.payload,collected_at=excluded.collected_at,
    status=excluded.status,source_count=excluded.source_count,error_code=excluded.error_code;

  insert into public.netguard_snapshot_runs(dataset_key,collected_at,status,source_count,error_code)
  values
    ('dashboard_24',saved_at,'success',greatest(coalesce(p_source_count,0),0),null),
    ('dashboard_72',saved_at,'success',greatest(coalesce(p_source_count,0),0),null),
    ('dashboard_168',saved_at,'success',greatest(coalesce(p_source_count,0),0),null);
  return true;
end;
$$;

revoke all on function public.netguard_publish_dashboard_cycle(text,text,jsonb,jsonb,jsonb,integer) from public;
grant execute on function public.netguard_publish_dashboard_cycle(text,text,jsonb,jsonb,jsonb,integer)
  to anon, authenticated, service_role;

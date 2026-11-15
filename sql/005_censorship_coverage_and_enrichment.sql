-- Expand the public OONI domain view and expose coverage metadata.
create or replace view public.censored_domains
with (security_invoker = true) as
select
  domain,
  bool_or(classification = 'confirmed') as confirmed_blocked,
  count(*) filter (where classification = 'confirmed')::integer as confirmed_measurements,
  count(*) filter (where classification = 'anomaly')::integer as anomaly_measurements,
  count(distinct probe_asn) filter (where probe_asn is not null)::integer as probe_networks,
  min(measurement_start_time) as first_observed_at,
  max(measurement_start_time) as last_observed_at,
  max(category_code) as category_code,
  count(*)::integer as measurement_count,
  max(measurement_start_time) filter (where classification = 'confirmed') as last_confirmed_at,
  max(measurement_start_time) filter (where classification = 'anomaly') as last_anomaly_at,
  min(measurement_start_time) filter (where classification = 'confirmed') as first_confirmed_at,
  min(measurement_start_time) filter (where classification = 'anomaly') as first_anomaly_at
from public.censorship_measurements
where measurement_start_time >= now() - interval '90 days'
group by domain;

create or replace view public.censorship_coverage
with (security_invoker = true) as
select
  count(distinct domain)::integer as domain_count,
  count(*)::integer as measurement_count,
  count(distinct probe_asn)::integer as probe_networks,
  count(*) filter (where classification = 'confirmed')::integer as confirmed_measurements,
  count(*) filter (where classification = 'anomaly')::integer as anomaly_measurements,
  min(measurement_start_time) as first_observed_at,
  max(measurement_start_time) as last_observed_at
from public.censorship_measurements
where measurement_start_time >= now() - interval '90 days';

grant select on public.censored_domains, public.censorship_coverage to anon, authenticated;

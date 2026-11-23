create schema if not exists net;
create extension if not exists pg_net with schema net;
create extension if not exists pg_cron;

-- Replace only this named job so this script is safe to re-run.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'netguard-ioda-collector'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'netguard-ioda-collector',
    '*/30 * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'netguard_project_url'
        ) || '/functions/v1/netguard-collector',
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

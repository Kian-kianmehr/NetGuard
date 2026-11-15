-- Persist every public dashboard payload and provide a narrowly scoped authenticated writer.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.netguard_snapshot_runs (
  id bigint generated always as identity primary key,
  dataset_key text not null,
  collected_at timestamptz not null default now(),
  status text not null check (status in ('success','partial','error')),
  source_count integer not null default 0,
  error_code text
);
create index if not exists netguard_snapshot_runs_dataset_time_idx
  on public.netguard_snapshot_runs(dataset_key, collected_at desc);
alter table public.netguard_snapshot_runs enable row level security;
drop policy if exists "public read snapshot runs" on public.netguard_snapshot_runs;
create policy "public read snapshot runs" on public.netguard_snapshot_runs
  for select to anon, authenticated using (true);
grant select on public.netguard_snapshot_runs to anon, authenticated;
grant all on public.netguard_snapshot_runs to service_role;

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
    'dashboard_24','dashboard_72','dashboard_168',
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
revoke all on function public.netguard_save_snapshot(text,text,jsonb,text,integer,text) from public;
grant execute on function public.netguard_save_snapshot(text,text,jsonb,text,integer,text) to anon, authenticated, service_role;

create table if not exists public.iran_datacenters (
  site_id text primary key,
  name text not null,
  operator text,
  city text,
  province text,
  asset_type text not null default 'data_center',
  evidence_level text not null check (evidence_level in ('operator_documented','operator_listed','third_party_listed','directory_candidate')),
  source_name text not null,
  source_url text not null,
  monitoring_status text not null default 'unmonitored',
  status_label text not null default 'پایش مستقیم فعال نیست',
  last_checked_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists iran_datacenters_city_idx on public.iran_datacenters(city);
alter table public.iran_datacenters enable row level security;
drop policy if exists "public read iran datacenter inventory" on public.iran_datacenters;
create policy "public read iran datacenter inventory" on public.iran_datacenters
  for select to anon, authenticated using (true);
grant select on public.iran_datacenters to anon, authenticated;
grant all on public.iran_datacenters to service_role;

insert into public.iran_datacenters
(site_id,name,operator,city,province,asset_type,evidence_level,source_name,source_url,monitoring_status,status_label,notes)
values
('asia-milad','Asiatech Milad Tower Data Center','Asiatech','تهران','تهران','data_center','operator_documented','Powerland Map','https://powerlandmap.com/intelligence/iran-data-centres-sites-operators-capacity','unmonitored','وضعیت عملیاتی نامشخص','مکان فیزیکی و خدمات میزبانی توسط مستندات اپراتور معرفی شده؛ این رکورد پایش زندهٔ NetGuard نیست.'),
('asia-azadegan','Asiatech Azadegan','Asiatech','تهران','تهران','hosting_location','operator_listed','Cloud.ir','https://cloud.ir/','unmonitored','وضعیت عملیاتی نامشخص','به‌عنوان محل ارائهٔ خدمات میزبانی معرفی شده؛ جزئیات مستقل سایت محدود است.'),
('asia-mir-emad','Asiatech Mir Emad','Asiatech','تهران','تهران','hosting_location','operator_listed','Cloud.ir','https://cloud.ir/','unmonitored','وضعیت عملیاتی نامشخص','به‌عنوان محل ارائهٔ خدمات میزبانی معرفی شده؛ جزئیات مستقل سایت محدود است.'),
('afranet-tehran','Afranet Data Center','Afranet','تهران','تهران','data_center','third_party_listed','Covered.ir / DataCenterMap','https://covered.ir/en/sites','unmonitored','وضعیت عملیاتی نامشخص','در فهرست سایت‌های پایش‌شدهٔ شخص ثالث و فهرست مراکز داده دیده می‌شود؛ دادهٔ زندهٔ آن از NetGuard دریافت نمی‌شود.'),
('shatel-dc2','Shatel DC2','Shatel','تهران','تهران','data_center','third_party_listed','Covered.ir','https://covered.ir/en/sites','unmonitored','وضعیت عملیاتی نامشخص','به‌عنوان مرکز دادهٔ داخلی در فهرست پایش شخص ثالث معرفی شده؛ دادهٔ آن در این نسخه مستقیماً از NetGuard سنجیده نمی‌شود.'),
('irancell-t3','MTN Irancell T3','Irancell','تهران','تهران','data_center','third_party_listed','Covered.ir','https://covered.ir/en/sites','unmonitored','وضعیت عملیاتی نامشخص','در فهرست نقاط پایش شخص ثالث آمده؛ وضعیت فنی فعلی در NetGuard تأیید نشده است.'),
('pars-online-tehran','Pars Online Data Center - Tehran','Pars Online','تهران','تهران','data_center','directory_candidate','DataCenterMap','https://www.datacentermap.com/iran/tehran/','unmonitored','نیازمند تأیید مستقل','فهرست تجاری مراکز داده؛ جزئیات سایت و وضعیت عملیاتی نیازمند راستی‌آزمایی است.'),
('pars-national','Pars National Data Center (PNDC)','Pars Online','نامشخص','نامشخص','data_center','directory_candidate','DataCenterCatalog','https://datacentercatalog.com/iran-gridview','unmonitored','نیازمند تأیید مستقل','در فهرست دایرکتوری مراکز داده آمده؛ مکان و وضعیت عملیاتی در منبع عمومی تأیید نشده است.'),
('mizban-paytakht','Mizban Paytakht IDC','Mizban Paytakht','تهران','تهران','data_center','directory_candidate','DataCenterMap','https://www.datacentermap.com/iran/tehran/','unmonitored','نیازمند تأیید مستقل','فهرست تجاری مراکز داده؛ جزئیات سایت و وضعیت عملیاتی نیازمند راستی‌آزمایی است.'),
('atieh-dp','Atieh Data Pardaz DataCenter','Atieh Data Pardaz','تهران','تهران','data_center','directory_candidate','DataCenterMap','https://www.datacentermap.com/iran/tehran/','unmonitored','نیازمند تأیید مستقل','فهرست تجاری مراکز داده؛ جزئیات سایت و وضعیت عملیاتی نیازمند راستی‌آزمایی است.'),
('bertina-idc','Bertina Datacenter (IDC)','Bertina','تهران','تهران','data_center','directory_candidate','DataCenterMap','https://www.datacentermap.com/iran/tehran/','unmonitored','نیازمند تأیید مستقل','فهرست تجاری مراکز داده؛ جزئیات سایت و وضعیت عملیاتی نیازمند راستی‌آزمایی است.'),
('mahanserver','MahanServer Data Center','MahanServer','تهران','تهران','data_center','directory_candidate','DataCenterMap','https://www.datacentermap.com/iran/tehran/','unmonitored','نیازمند تأیید مستقل','فهرست تجاری مراکز داده؛ جزئیات سایت و وضعیت عملیاتی نیازمند راستی‌آزمایی است.'),
('amin-idc-qom','Amin IDC','Amin IDC','قم','قم','data_center','directory_candidate','DataCenterMap','https://www.datacentermap.com/iran/','unmonitored','نیازمند تأیید مستقل','در دایرکتوری مراکز داده ثبت شده؛ جزئیات سایت و وضعیت عملیاتی نیازمند راستی‌آزمایی است.')
on conflict (site_id) do update set
  name=excluded.name,operator=excluded.operator,city=excluded.city,province=excluded.province,
  asset_type=excluded.asset_type,evidence_level=excluded.evidence_level,
  source_name=excluded.source_name,source_url=excluded.source_url,
  notes=excluded.notes,updated_at=now();

-- Run aggregate snapshot generation after the three raw-data collectors have had time to finish.
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname='netguard-aggregate-snapshots'
  loop perform cron.unschedule(j); end loop;
  perform cron.schedule(
    'netguard-aggregate-snapshots','3,13,23,33,43,53 * * * *',
    $job$select net.http_post(
      url := 'https://netguard-api-oan9.onrender.com/internal/collect-snapshots',
      headers := jsonb_build_object('Content-Type','application/json',
        'x-netguard-token',(select decrypted_secret from vault.decrypted_secrets where name='netguard_collector_token')),
      body := jsonb_build_object('triggered_at',now()), timeout_milliseconds := 120000
    );$job$
  );
end $$;

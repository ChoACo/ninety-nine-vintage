begin;

create or replace function app_private.invoke_storage_policy_probe()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe_url text;
  v_probe_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_probe_url
  from vault.decrypted_secrets
  where name = 'storage_policy_probe_url'
  limit 1;

  select decrypted_secret into v_probe_secret
  from vault.decrypted_secrets
  where name = 'web_push_dispatch_secret'
  limit 1;

  if nullif(btrim(coalesce(v_probe_url, '')), '') is null
    or nullif(btrim(coalesce(v_probe_secret, '')), '') is null
  then
    return null;
  end if;

  select net.http_get(
    url := v_probe_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_probe_secret
    ),
    timeout_milliseconds := 30000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function app_private.invoke_storage_policy_probe()
from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from pg_extension where extname = 'pg_net')
  then
    raise exception 'storage policy scheduling requires pg_cron and pg_net';
  end if;

  select jobid into v_job_id
  from cron.job
  where jobname = 'probe-storage-routing-policy'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'probe-storage-routing-policy',
    '17 */6 * * *',
    'select app_private.invoke_storage_policy_probe();'
  );
end;
$$;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop function if exists app_private.multi_provider_records_exec(text, jsonb);

create or replace function public.get_multicloud_storage_usage()
returns table (
  storage_provider_id text,
  total_bytes bigint,
  record_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select records.storage_provider_id,
         coalesce(sum(coalesce(pg_column_size(records.payload), 0)), 0)::bigint,
         count(*)::bigint
  from public.multi_provider_records as records
  group by records.storage_provider_id
  order by records.storage_provider_id;
$$;

revoke all on function public.get_multicloud_storage_usage() from public, anon, authenticated;
grant execute on function public.get_multicloud_storage_usage() to service_role;

comment on function public.get_multicloud_storage_usage() is
  'Service-role-only bounded aggregate for the Owner storage gauge. Replaces the retired arbitrary SQL executor.';

commit;

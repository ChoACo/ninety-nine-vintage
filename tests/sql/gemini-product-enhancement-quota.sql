\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.account_access_roles (
  user_id uuid primary key,
  role_code text not null
);

insert into public.account_access_roles (user_id, role_code)
values
  ('00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', 'member');

\ir /workspace/supabase/migrations/20260803151227_reserve_gemini_product_enhancement_daily_quota.sql

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

do $$
declare
  v_result record;
  v_index integer;
begin
  for v_index in 1..300 loop
    select * into strict v_result
    from public.reserve_gemini_product_enhancement_quota();

    if not v_result.allowed or v_result.used <> v_index or v_result.daily_limit <> 300 then
      raise exception 'unexpected quota result at %: %', v_index, row_to_json(v_result);
    end if;
  end loop;

  select * into strict v_result
  from public.reserve_gemini_product_enhancement_quota();
  if v_result.allowed or v_result.used <> 300 or v_result.daily_limit <> 300 then
    raise exception '301st request did not fail closed: %', row_to_json(v_result);
  end if;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

do $$
begin
  perform public.reserve_gemini_product_enhancement_quota();
  raise exception 'member unexpectedly reserved Gemini quota';
exception
  when insufficient_privilege then
    null;
end;
$$;

reset role;

do $$
begin
  if has_table_privilege(
    'authenticated',
    'app_private.gemini_product_enhancement_daily_usage',
    'select'
  ) then
    raise exception 'authenticated role can read the private quota table';
  end if;

  if (
    select request_count <> 300
    from app_private.gemini_product_enhancement_daily_usage
    where usage_date = timezone('Asia/Seoul', statement_timestamp())::date
  ) then
    raise exception 'stored quota count is not 300';
  end if;
end;
$$;

select 'gemini quota contract passed' as result;

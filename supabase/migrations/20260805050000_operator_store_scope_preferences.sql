begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Stage 4: operator store scope selection. An operator assigned to multiple
-- centers can choose "전체 센터" (all centers) or a single center to focus on.
-- The selection is stored per user so it survives session resets.

create table public.operator_store_scope_preferences (
  user_id uuid primary key
    references public.profiles(id) on delete cascade,
  selected_store_id uuid references public.stores(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.operator_store_scope_preferences enable row level security;
alter table public.operator_store_scope_preferences force row level security;

revoke all on table public.operator_store_scope_preferences
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.operator_store_scope_preferences
  to authenticated, service_role;

create policy "Staff read their store scope preference"
  on public.operator_store_scope_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Staff create their store scope preference"
  on public.operator_store_scope_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Staff update their store scope preference"
  on public.operator_store_scope_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function app_private.set_operator_store_scope_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.set_operator_store_scope_updated_at()
  from public, anon, authenticated, service_role;

create trigger operator_store_scope_preferences_set_updated_at
before update on public.operator_store_scope_preferences
for each row execute function app_private.set_operator_store_scope_updated_at();

comment on table public.operator_store_scope_preferences
  is 'Per-operator center scope preference persisted so the selected center survives session resets.';
comment on column public.operator_store_scope_preferences.selected_store_id
  is 'null means "전체 센터" (all assigned centers); otherwise the operator focuses on this store.';

create or replace function public.get_operator_store_scope()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.operator_store_scope_preferences%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if public.access_role_for_user(v_user_id) not in ('operator', 'owner') then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  select * into v_row from public.operator_store_scope_preferences
  where user_id = v_user_id;
  if not found then
    return jsonb_build_object('scope', 'all', 'storeId', null);
  end if;
  return jsonb_build_object(
    'scope', case when v_row.selected_store_id is null then 'all' else 'store' end,
    'storeId', v_row.selected_store_id
  );
end;
$$;

revoke all on function public.get_operator_store_scope()
  from public, anon;
grant execute on function public.get_operator_store_scope() to authenticated;

create or replace function public.set_operator_store_scope(
  p_scope text,
  p_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_scope not in ('all', 'store') then
    raise exception using errcode = '22023', message = '센터 범위를 확인해 주세요.';
  end if;
  if p_scope = 'store' then
    if p_store_id is null then
      raise exception using errcode = '22023', message = '센터를 선택해 주세요.';
    end if;
    select * into v_store from public.stores
    where id = p_store_id and is_active;
    if not found then
      raise exception using errcode = 'P0002', message = '활성 센터를 찾을 수 없습니다.';
    end if;
    if not (public.is_owner()
      or public.has_store_permission(v_store.id, 'manage_products')) then
      raise exception using errcode = '42501', message = '배정된 센터만 선택할 수 있습니다.';
    end if;
  end if;
  insert into public.operator_store_scope_preferences (user_id, selected_store_id)
  values (v_user_id, case when p_scope = 'store' then p_store_id else null end)
  on conflict (user_id) do update set
    selected_store_id = excluded.selected_store_id,
    updated_at = clock_timestamp();
  return jsonb_build_object('scope', p_scope, 'storeId', case when p_scope = 'store' then p_store_id else null end);
end;
$$;

revoke all on function public.set_operator_store_scope(text, uuid)
  from public, anon;
grant execute on function public.set_operator_store_scope(text, uuid) to authenticated;

commit;

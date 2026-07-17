-- Internal access grades, privacy-safe staff operations, compact revenue
-- summaries, and warning-based bid enforcement.
--
-- This migration deliberately does not redefine place_bid() or any auction
-- closing/date-window function. The existing 20:56/21:00 and recent-close
-- rules remain byte-for-byte unchanged; bid sanctions are enforced by a
-- separate BEFORE INSERT trigger.

do $$
declare
  v_owner_count integer;
begin
  select count(*)::integer
  into v_owner_count
  from auth.users as users
  join public.profiles as profiles on profiles.id = users.id
  where users.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and exists (
      select 1
      from auth.identities as identities
      where identities.user_id = users.id
        and identities.provider = 'kakao'
    );

  if v_owner_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = '지정된 Kakao owner Auth 계정을 확인할 수 없습니다.';
  end if;
end;
$$;

create table if not exists public.account_access_roles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role_code text not null
    check (role_code in ('owner', 'operator', 'employee', 'band_member', 'member')),
  grade_level numeric(2, 1) generated always as (
    case role_code
      when 'owner' then 0.0
      when 'operator' then 1.0
      when 'employee' then 2.0
      when 'band_member' then 2.5
      when 'member' then 3.0
    end
  ) stored,
  reports_to_operator_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_access_roles_single_owner_idx
  on public.account_access_roles (role_code)
  where role_code = 'owner';
create index if not exists account_access_roles_role_idx
  on public.account_access_roles (role_code, user_id);
create index if not exists account_access_roles_reports_to_idx
  on public.account_access_roles (reports_to_operator_id)
  where reports_to_operator_id is not null;

alter table public.account_access_roles enable row level security;
revoke all on public.account_access_roles from anon, authenticated;

create or replace function public.set_account_access_roles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_account_access_roles_updated_at() from public;

drop trigger if exists account_access_roles_set_updated_at
on public.account_access_roles;
create trigger account_access_roles_set_updated_at
before update on public.account_access_roles
for each row execute function public.set_account_access_roles_updated_at();

create or replace function public.auth_user_has_kakao_identity(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.identities as identities
    where identities.user_id = p_user_id
      and identities.provider = 'kakao'
  );
$$;

revoke all on function public.auth_user_has_kakao_identity(uuid) from public;

create or replace function public.validate_account_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.role_code = 'owner'
    and (
      new.user_id <> old.user_id
      or new.role_code <> old.role_code
      or new.reports_to_operator_id is distinct from old.reports_to_operator_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'owner 역할은 변경하거나 이전할 수 없습니다.';
  end if;

  if tg_op = 'UPDATE'
    and old.role_code = 'operator'
    and new.role_code <> 'operator'
    and exists (
      select 1
      from public.account_access_roles as employee_roles
      where employee_roles.role_code = 'employee'
        and employee_roles.reports_to_operator_id = old.user_id
    )
  then
    raise exception using
      errcode = '23514',
      message = '담당 직원의 역할을 먼저 변경한 뒤 운영자 권한을 해제해 주세요.';
  end if;

  if new.role_code = 'owner' then
    if new.reports_to_operator_id is not null or not exists (
      select 1
      from auth.users as users
      where users.id = new.user_id
        and users.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
        and public.auth_user_has_kakao_identity(users.id)
    ) then
      raise exception using
        errcode = '23514',
        message = 'owner 역할은 지정된 관리자 Auth 계정에만 유지할 수 있습니다.';
    end if;
  elsif not public.auth_user_has_kakao_identity(new.user_id) then
    raise exception using
      errcode = '23514',
      message = 'owner 이외의 모든 역할은 Kakao 인증 계정에만 부여할 수 있습니다.';
  end if;

  if new.role_code <> 'employee' and new.reports_to_operator_id is not null then
    raise exception using
      errcode = '23514',
      message = '담당 운영자는 직원 역할에만 지정할 수 있습니다.';
  end if;

  if new.role_code = 'employee' and new.reports_to_operator_id is null then
    raise exception using
      errcode = '23514',
      message = '직원에게는 담당 운영자를 지정해야 합니다.';
  end if;

  if new.reports_to_operator_id is not null and not exists (
    select 1
    from public.account_access_roles as roles
    where roles.user_id = new.reports_to_operator_id
      and roles.role_code = 'operator'
      and public.auth_user_has_kakao_identity(roles.user_id)
  ) then
    raise exception using
      errcode = '23514',
      message = '담당 운영자는 현재 유효한 Kakao 운영자여야 합니다.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_account_access_role() from public;

drop trigger if exists account_access_roles_validate
on public.account_access_roles;
create trigger account_access_roles_validate
before insert or update on public.account_access_roles
for each row execute function public.validate_account_access_role();

create or replace function public.protect_owner_access_role_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role_code = 'owner' then
    raise exception using errcode = '42501', message = 'owner 역할 행은 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_owner_access_role_delete() from public;

drop trigger if exists account_access_roles_protect_owner_delete
on public.account_access_roles;
create trigger account_access_roles_protect_owner_delete
before delete on public.account_access_roles
for each row execute function public.protect_owner_access_role_delete();

create or replace function public.sync_access_role_to_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_role text;
  v_metadata jsonb;
begin
  v_auth_role := case when new.role_code = 'owner' then 'admin' else new.role_code end;

  select coalesce(users.raw_app_meta_data, '{}'::jsonb)
  into v_metadata
  from auth.users as users
  where users.id = new.user_id
  for update;

  if v_metadata is null then
    raise exception using errcode = '23503', message = '역할을 연결할 Auth 사용자가 없습니다.';
  end if;

  v_metadata := jsonb_set(v_metadata, '{role}', to_jsonb(v_auth_role), true);
  if new.role_code <> 'operator' then
    v_metadata := v_metadata - 'operator_id';
  end if;

  update auth.users
  set
    raw_app_meta_data = v_metadata,
    updated_at = clock_timestamp()
  where id = new.user_id;

  return new;
end;
$$;

revoke all on function public.sync_access_role_to_auth_metadata() from public;

drop trigger if exists account_access_roles_sync_auth_metadata
on public.account_access_roles;
create trigger account_access_roles_sync_auth_metadata
after insert or update of role_code on public.account_access_roles
for each row execute function public.sync_access_role_to_auth_metadata();

-- The single hidden owner is seeded first. Legacy ID/password operator_accounts
-- are intentionally not imported: all non-owner access now requires Kakao.
insert into public.account_access_roles (
  user_id,
  role_code,
  reports_to_operator_id
)
select profiles.id, 'owner', null
from public.profiles as profiles
join auth.users as users on users.id = profiles.id
where users.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
  and public.auth_user_has_kakao_identity(users.id)
on conflict (user_id) do update
set
  role_code = 'owner',
  reports_to_operator_id = null;

insert into public.account_access_roles (
  user_id,
  role_code,
  reports_to_operator_id
)
select profiles.id, 'member', null
from public.profiles as profiles
where public.auth_user_has_kakao_identity(profiles.id)
  and not exists (
    select 1
    from public.account_access_roles as roles
    where roles.user_id = profiles.id
  )
on conflict (user_id) do nothing;

-- The former email/password administrator is removed only after the new
-- Kakao owner row and its server-managed admin metadata are both confirmed.
do $$
begin
  if not exists (
    select 1
    from public.account_access_roles as roles
    join auth.users as users on users.id = roles.user_id
    where roles.user_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
      and roles.role_code = 'owner'
      and users.raw_app_meta_data ->> 'role' = 'admin'
      and exists (
        select 1
        from auth.identities as identities
        where identities.user_id = roles.user_id
          and identities.provider = 'kakao'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = '새 Kakao owner 검증에 실패하여 기존 관리자 계정을 보존했습니다.';
  end if;

  delete from auth.users as users
  where lower(users.email::text) = 'cocoaline082@gmail.com'
    and users.id <> '30be08c2-6259-42c6-af26-4ded6362de12'::uuid;
end;
$$;

create or replace function public.assign_kakao_member_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.auth_user_has_kakao_identity(new.id) then
    insert into public.account_access_roles (
      user_id,
      role_code,
      reports_to_operator_id
    )
    values (new.id, 'member', null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_kakao_member_access_role() from public;

drop trigger if exists profiles_assign_kakao_member_access_role
on public.profiles;
create trigger profiles_assign_kakao_member_access_role
after insert on public.profiles
for each row execute function public.assign_kakao_member_access_role();

create or replace function public.assign_kakao_identity_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'kakao' and exists (
    select 1 from public.profiles as profiles where profiles.id = new.user_id
  ) then
    insert into public.account_access_roles (
      user_id,
      role_code,
      reports_to_operator_id
    )
    values (new.user_id, 'member', null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_kakao_identity_access_role() from public;

drop trigger if exists auth_identities_assign_kakao_access_role
on auth.identities;
create trigger auth_identities_assign_kakao_access_role
after insert on auth.identities
for each row execute function public.assign_kakao_identity_access_role();

create or replace function public.assign_kakao_identity_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'kakao' and exists (
    select 1 from public.profiles as profiles where profiles.id = new.user_id
  ) then
    insert into public.account_access_roles (
      user_id,
      role_code,
      reports_to_operator_id
    )
    values (new.user_id, 'member', null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_kakao_identity_access_role() from public;

drop trigger if exists auth_identities_assign_kakao_access_role
on auth.identities;
create trigger auth_identities_assign_kakao_access_role
after insert or update of provider, user_id on auth.identities
for each row execute function public.assign_kakao_identity_access_role();

create or replace function public.protect_owner_kakao_identity_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and old.provider = 'kakao'
    and (
      new.user_id is distinct from old.user_id
      or new.provider is distinct from old.provider
    )
  then
    raise exception using
      errcode = '42501',
      message = 'owner Kakao 인증 신원은 변경하거나 이전할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_owner_kakao_identity_update() from public;

drop trigger if exists auth_identities_protect_owner_update on auth.identities;
create trigger auth_identities_protect_owner_update
before update of user_id, provider on auth.identities
for each row execute function public.protect_owner_kakao_identity_update();

create or replace function public.protect_owner_kakao_identity_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and old.provider = 'kakao'
  then
    raise exception using errcode = '42501', message = 'owner Kakao 인증 신원은 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_owner_kakao_identity_delete() from public;

drop trigger if exists auth_identities_protect_owner_delete on auth.identities;
create trigger auth_identities_protect_owner_delete
before delete on auth.identities
for each row execute function public.protect_owner_kakao_identity_delete();

create or replace function public.protect_owner_auth_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and (
      new.id <> old.id
      or coalesce(new.raw_app_meta_data ->> 'role', '') <> 'admin'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Kakao owner 식별자와 관리자 역할은 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_owner_auth_update() from public;

drop trigger if exists auth_users_protect_owner_update on auth.users;
create trigger auth_users_protect_owner_update
before update of id, raw_app_meta_data on auth.users
for each row execute function public.protect_owner_auth_update();

create or replace function public.protect_owner_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid then
    raise exception using errcode = '42501', message = 'owner Auth 계정은 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_owner_auth_delete() from public;

drop trigger if exists auth_users_protect_owner_delete on auth.users;
create trigger auth_users_protect_owner_delete
before delete on auth.users
for each row execute function public.protect_owner_auth_delete();

create or replace function public.access_role_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when roles.role_code = 'owner' and exists (
      select 1 from auth.users as users
      where users.id = roles.user_id
        and users.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
        and public.auth_user_has_kakao_identity(users.id)
    ) then 'owner'
    when roles.role_code <> 'owner'
      and public.auth_user_has_kakao_identity(roles.user_id)
    then roles.role_code
    else null
  end
  from public.account_access_roles as roles
  where roles.user_id = p_user_id;
$$;

revoke all on function public.access_role_for_user(uuid) from public;

create or replace function public.current_access_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.access_role_for_user(auth.uid());
$$;

revoke all on function public.current_access_role() from public;
grant execute on function public.current_access_role() to authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.access_role_for_user(auth.uid()) = 'owner', false);
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.access_role_for_user(auth.uid()) = 'operator', false);
$$;

revoke all on function public.is_operator() from public;
grant execute on function public.is_operator() to authenticated;

create or replace function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.access_role_for_user(auth.uid()) = 'employee', false);
$$;

revoke all on function public.is_employee() from public;
grant execute on function public.is_employee() to authenticated;

create or replace function public.can_manage_members()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.access_role_for_user(auth.uid()) in ('owner', 'operator'),
    false
  );
$$;

revoke all on function public.can_manage_members() from public;
grant execute on function public.can_manage_members() to authenticated;

create or replace function public.can_manage_products()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.access_role_for_user(auth.uid()) in ('owner', 'operator', 'employee'),
    false
  );
$$;

revoke all on function public.can_manage_products() from public;
grant execute on function public.can_manage_products() to authenticated;

create or replace function public.can_view_shipping_queue()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.access_role_for_user(auth.uid()) in ('owner', 'operator', 'employee'),
    false
  );
$$;

revoke all on function public.can_view_shipping_queue() from public;
grant execute on function public.can_view_shipping_queue() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner();
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_members();
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.access_role_for_user(auth.uid()) in ('band_member', 'member')
    and exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = auth.uid()
        and accounts.account_status = 'active'
    )
    and public.has_required_kakao_profile(),
    false
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- Owner rows are never visible through an operator profile policy. Employees,
-- band members, and members retain only the existing own-profile policy.
drop policy if exists "Staff read member profiles" on public.profiles;
drop policy if exists "Owners read all profiles" on public.profiles;
drop policy if exists "Operators read non-owner profiles" on public.profiles;

create policy "Owners read all profiles"
on public.profiles
for select
to authenticated
using ((select public.is_owner()));

create policy "Operators read non-owner profiles"
on public.profiles
for select
to authenticated
using (
  (select public.is_operator())
  and coalesce(public.access_role_for_user(id), '') <> 'owner'
);

create table if not exists public.account_last_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.account_last_seen enable row level security;
revoke all on public.account_last_seen from anon, authenticated;

create or replace function public.touch_my_last_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  insert into public.account_last_seen (user_id, last_seen_at)
  values (auth.uid(), v_now)
  on conflict (user_id) do update
  set last_seen_at = excluded.last_seen_at;

  return v_now;
end;
$$;

revoke all on function public.touch_my_last_seen() from public;
grant execute on function public.touch_my_last_seen() to authenticated;

create table if not exists public.member_warnings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  category text not null
    check (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  reason text not null
    check (char_length(btrim(reason)) between 1 and 500),
  warning_number integer not null check (warning_number > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, warning_number)
);

create index if not exists member_warnings_member_time_idx
  on public.member_warnings (member_id, created_at desc);

create table if not exists public.member_bid_sanctions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  warning_id uuid not null unique references public.member_warnings (id) on delete restrict,
  sanction_round integer not null check (sanction_round > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (member_id, sanction_round)
);

create index if not exists member_bid_sanctions_active_idx
  on public.member_bid_sanctions (member_id, ends_at desc);

create table if not exists public.cancelled_auction_bids (
  original_bid_id uuid primary key,
  product_id uuid not null,
  bidder_id uuid references public.profiles (id) on delete set null,
  bidder_display_name text not null,
  amount bigint not null check (amount > 0),
  original_created_at timestamptz not null,
  was_final boolean not null,
  sanction_id uuid references public.member_bid_sanctions (id) on delete set null,
  cancelled_at timestamptz not null default now(),
  cancellation_reason text not null default 'warning_sanction'
);

create index if not exists cancelled_auction_bids_member_time_idx
  on public.cancelled_auction_bids (bidder_id, original_created_at desc);
create index if not exists cancelled_auction_bids_product_idx
  on public.cancelled_auction_bids (product_id, original_created_at desc);

alter table public.member_warnings enable row level security;
alter table public.member_bid_sanctions enable row level security;
alter table public.cancelled_auction_bids enable row level security;
revoke all on public.member_warnings from anon, authenticated;
revoke all on public.member_bid_sanctions from anon, authenticated;
revoke all on public.cancelled_auction_bids from anon, authenticated;

create or replace function public.is_payment_deadline_exempt(
  p_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.access_role_for_user(p_member_id) = 'band_member',
    false
  );
$$;

revoke all on function public.is_payment_deadline_exempt(uuid) from public;

create or replace function public.cancel_member_active_bids(
  p_member_id uuid,
  p_sanction_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_ids uuid[];
  v_product_id uuid;
  v_participant_count integer;
  v_bid_history jsonb;
  v_top_amount bigint;
  v_final_bid_id uuid;
  v_final_amount bigint;
  v_final_created_at timestamptz;
  v_deleted integer;
  v_cancelled_total integer := 0;
begin
  select array_agg(affected.product_id order by affected.product_id)
  into v_product_ids
  from (
    select distinct bids.product_id
    from public.auction_bids as bids
    join public.products as products on products.id = bids.product_id
    where bids.bidder_id = p_member_id
      and products.status in ('pending', 'active')
  ) as affected;

  if v_product_ids is null then
    return 0;
  end if;

  foreach v_product_id in array v_product_ids loop
    perform 1
    from public.products as products
    where products.id = v_product_id
    for update;

    insert into public.cancelled_auction_bids (
      original_bid_id,
      product_id,
      bidder_id,
      bidder_display_name,
      amount,
      original_created_at,
      was_final,
      sanction_id,
      cancelled_at
    )
    select
      bids.id,
      bids.product_id,
      bids.bidder_id,
      bids.bidder_display_name,
      bids.amount,
      bids.created_at,
      bids.is_final,
      p_sanction_id,
      p_now
    from public.auction_bids as bids
    where bids.product_id = v_product_id
      and bids.bidder_id = p_member_id
    on conflict (original_bid_id) do nothing;

    update public.products as products
    set
      bid_locked_at = null,
      final_bid_id = null,
      final_bid_amount = null
    where products.id = v_product_id
      and products.final_bid_id in (
        select bids.id
        from public.auction_bids as bids
        where bids.product_id = v_product_id
          and bids.bidder_id = p_member_id
      );

    delete from public.auction_bids as bids
    where bids.product_id = v_product_id
      and bids.bidder_id = p_member_id;
    get diagnostics v_deleted = row_count;
    v_cancelled_total := v_cancelled_total + v_deleted;

    select count(distinct bids.bidder_id)::integer
    into v_participant_count
    from public.auction_bids as bids
    where bids.product_id = v_product_id
      and bids.bidder_id is not null;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bids.id::text,
          'bidAt', bids.created_at,
          'bidderName', bids.bidder_display_name,
          'amount', bids.amount
        )
        order by bids.created_at desc, bids.id desc
      ),
      '[]'::jsonb
    )
    into v_bid_history
    from public.auction_bids as bids
    where bids.product_id = v_product_id;

    v_top_amount := null;
    select bids.amount
    into v_top_amount
    from public.auction_bids as bids
    where bids.product_id = v_product_id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1;

    v_final_bid_id := null;
    v_final_amount := null;
    v_final_created_at := null;
    select bids.id, bids.amount, bids.created_at
    into v_final_bid_id, v_final_amount, v_final_created_at
    from public.auction_bids as bids
    where bids.product_id = v_product_id
      and bids.is_final
    order by bids.created_at desc, bids.id desc
    limit 1;

    update public.products as products
    set
      current_price = coalesce(v_top_amount, products.starting_price),
      participant_count = coalesce(v_participant_count, 0),
      bid_history = v_bid_history,
      bid_locked_at = v_final_created_at,
      final_bid_id = v_final_bid_id,
      final_bid_amount = v_final_amount
    where products.id = v_product_id;
  end loop;

  return v_cancelled_total;
end;
$$;

revoke all on function public.cancel_member_active_bids(uuid, uuid, timestamptz)
from public;

create or replace function public.enforce_member_bid_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_key bigint;
  v_blocked_until timestamptz;
begin
  if new.bidder_id is null then
    return new;
  end if;

  v_lock_key := hashtextextended(
    'member-warning-enforcement:' || new.bidder_id::text,
    0
  );

  -- Never wait while place_bid() is already holding a product row lock. If a
  -- warning transaction owns the member lock, fail fast and let it recalculate.
  if not pg_try_advisory_xact_lock(v_lock_key) then
    raise exception using
      errcode = 'P0001',
      message = '입찰 제한 상태를 갱신 중입니다. 잠시 후 다시 시도해 주세요.';
  end if;

  select max(sanctions.ends_at)
  into v_blocked_until
  from public.member_bid_sanctions as sanctions
  where sanctions.member_id = new.bidder_id
    and sanctions.ends_at > clock_timestamp();

  if v_blocked_until is not null then
    raise exception using
      errcode = '42501',
      message = format('누적 경고 제재로 %s까지 입찰할 수 없습니다.', v_blocked_until);
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_member_bid_eligibility() from public;

drop trigger if exists auction_bids_enforce_member_eligibility
on public.auction_bids;
create trigger auction_bids_enforce_member_eligibility
before insert on public.auction_bids
for each row execute function public.enforce_member_bid_eligibility();

create or replace function public.add_member_warning(
  p_member_id uuid,
  p_category text,
  p_reason text
)
returns table (
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  cancelled_bid_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_target_role text;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_warning_count integer;
  v_sanction_count integer;
  v_blocked_until timestamptz;
  v_warning_id uuid;
  v_sanction_id uuid;
  v_sanction_round integer;
  v_now timestamptz := clock_timestamp();
  v_cancelled_count integer := 0;
  v_lock_key bigint;
begin
  if v_actor_role not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '회원 경고를 등록할 권한이 없습니다.';
  end if;
  if v_category !~ '^[a-z][a-z0-9_]{1,39}$'
    or char_length(v_reason) not between 1 and 500
  then
    raise exception using errcode = '22023', message = '경고 분류와 사유를 확인해 주세요.';
  end if;

  v_lock_key := hashtextextended(
    'member-warning-enforcement:' || p_member_id::text,
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  select public.access_role_for_user(p_member_id)
  into v_target_role;
  if v_target_role not in ('band_member', 'member') then
    raise exception using errcode = '42501', message = '일반 회원에게만 경고를 등록할 수 있습니다.';
  end if;

  select count(*)::integer
  into v_warning_count
  from public.member_warnings as warnings
  where warnings.member_id = p_member_id;

  select count(*)::integer, max(sanctions.ends_at)
  into v_sanction_count, v_blocked_until
  from public.member_bid_sanctions as sanctions
  where sanctions.member_id = p_member_id;

  -- Grade 2.5 is exempt only from the payment-deadline/late-payment path.
  if v_category = 'late_payment'
    and public.is_payment_deadline_exempt(p_member_id)
  then
    return query select
      v_warning_count,
      v_sanction_count,
      case when v_blocked_until > v_now then v_blocked_until else null end,
      0;
    return;
  end if;

  v_warning_count := v_warning_count + 1;
  insert into public.member_warnings (
    member_id,
    category,
    reason,
    warning_number,
    created_by,
    created_at
  )
  values (
    p_member_id,
    v_category,
    v_reason,
    v_warning_count,
    auth.uid(),
    v_now
  )
  returning id into v_warning_id;

  if mod(v_warning_count, 3) = 0 then
    v_sanction_round := v_sanction_count + 1;
    v_blocked_until := greatest(v_now, coalesce(v_blocked_until, v_now))
      + make_interval(days => v_sanction_round);

    insert into public.member_bid_sanctions (
      member_id,
      warning_id,
      sanction_round,
      starts_at,
      ends_at
    )
    values (
      p_member_id,
      v_warning_id,
      v_sanction_round,
      v_now,
      v_blocked_until
    )
    returning id into v_sanction_id;

    v_sanction_count := v_sanction_round;
    v_cancelled_count := public.cancel_member_active_bids(
      p_member_id,
      v_sanction_id,
      v_now
    );
  end if;

  return query select
    v_warning_count,
    v_sanction_count,
    case when v_blocked_until > v_now then v_blocked_until else null end,
    v_cancelled_count;
end;
$$;

revoke all on function public.add_member_warning(uuid, text, text) from public;
grant execute on function public.add_member_warning(uuid, text, text) to authenticated;

create or replace function public.get_my_enforcement_status()
returns table (
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  payment_deadline_exempt boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.member_warnings as warnings
      where warnings.member_id = auth.uid()),
    (select count(*)::integer from public.member_bid_sanctions as sanctions
      where sanctions.member_id = auth.uid()),
    (select max(sanctions.ends_at) from public.member_bid_sanctions as sanctions
      where sanctions.member_id = auth.uid()
        and sanctions.ends_at > clock_timestamp()),
    public.is_payment_deadline_exempt(auth.uid());
$$;

revoke all on function public.get_my_enforcement_status() from public;
grant execute on function public.get_my_enforcement_status() to authenticated;

drop function if exists public.get_staff_member_directory(integer, integer);
create function public.get_staff_member_directory(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id uuid,
  display_name text,
  legal_name text,
  email text,
  phone text,
  gender text,
  birth_year smallint,
  kakao_profile_complete boolean,
  kakao_synced_at timestamptz,
  account_status text,
  shipping_credit_count integer,
  address_count bigint,
  bid_count bigint,
  support_status text,
  created_at timestamptz,
  last_seen_at timestamptz,
  access_role text,
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  payment_deadline_exempt boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 조회 권한이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or p_offset is null or p_offset < 0
  then
    raise exception using errcode = '22023', message = '회원 목록 페이지 범위를 확인해 주세요.';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name,
    kakao_profiles.full_name,
    users.email::text,
    accounts.phone,
    kakao_profiles.gender,
    kakao_profiles.birth_year,
    coalesce(kakao_profiles.profile_complete, false),
    kakao_profiles.last_synced_at,
    accounts.account_status,
    accounts.shipping_credit_count,
    (
      select count(*) from public.shipping_addresses as addresses
      where addresses.member_id = profiles.id
    ),
    (
      select count(*) from public.auction_bids as bids
      where bids.bidder_id = profiles.id
    ),
    (
      select conversations.status
      from public.support_conversations as conversations
      where conversations.member_id = profiles.id
      order by
        (conversations.status = 'open') desc,
        conversations.last_message_at desc nulls last,
        conversations.created_at desc
      limit 1
    ),
    profiles.created_at,
    coalesce(last_seen.last_seen_at, users.last_sign_in_at),
    roles.role_code,
    (
      select count(*)::integer from public.member_warnings as warnings
      where warnings.member_id = profiles.id
    ),
    (
      select count(*)::integer from public.member_bid_sanctions as sanctions
      where sanctions.member_id = profiles.id
    ),
    (
      select max(sanctions.ends_at)
      from public.member_bid_sanctions as sanctions
      where sanctions.member_id = profiles.id
        and sanctions.ends_at > clock_timestamp()
    ),
    roles.role_code = 'band_member'
  from public.profiles as profiles
  join auth.users as users on users.id = profiles.id
  join public.member_accounts as accounts on accounts.member_id = profiles.id
  join public.account_access_roles as roles on roles.user_id = profiles.id
  left join public.kakao_member_profiles as kakao_profiles
    on kakao_profiles.member_id = profiles.id
  left join public.account_last_seen as last_seen
    on last_seen.user_id = profiles.id
  where (
      roles.role_code in ('employee', 'band_member', 'member')
      or (public.is_owner() and roles.role_code = 'operator')
    )
    and public.auth_user_has_kakao_identity(profiles.id)
  order by profiles.created_at desc, profiles.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_staff_member_directory(integer, integer) from public;
grant execute on function public.get_staff_member_directory(integer, integer)
to authenticated;

create or replace function public.get_owner_operator_directory()
returns table (
  id uuid,
  display_name text,
  email text,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'owner 권한이 필요합니다.';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name,
    users.email::text,
    coalesce(last_seen.last_seen_at, users.last_sign_in_at)
  from public.account_access_roles as roles
  join public.profiles as profiles on profiles.id = roles.user_id
  join auth.users as users on users.id = roles.user_id
  left join public.account_last_seen as last_seen on last_seen.user_id = roles.user_id
  where roles.role_code = 'operator'
    and public.auth_user_has_kakao_identity(roles.user_id)
  order by profiles.display_name, profiles.id;
end;
$$;

revoke all on function public.get_owner_operator_directory() from public;
grant execute on function public.get_owner_operator_directory() to authenticated;

create or replace function public.set_member_access_role(
  p_member_id uuid,
  p_role_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_current_role text;
  v_requested_role text := lower(btrim(coalesce(p_role_code, '')));
  v_reports_to uuid;
begin
  if v_actor_role not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '등급 변경 권한이 없습니다.';
  end if;
  if v_requested_role not in ('operator', 'employee', 'band_member', 'member') then
    raise exception using errcode = '22023', message = '변경할 수 없는 회원 등급입니다.';
  end if;
  if v_actor_role = 'operator' and v_requested_role = 'operator' then
    raise exception using errcode = '42501', message = '운영자 지정은 owner만 할 수 있습니다.';
  end if;

  select roles.role_code
  into v_current_role
  from public.account_access_roles as roles
  where roles.user_id = p_member_id
  for update;

  if v_current_role is null then
    raise exception using errcode = 'P0002', message = '변경할 Kakao 회원을 찾을 수 없습니다.';
  end if;
  if v_current_role = 'owner' then
    raise exception using errcode = '42501', message = 'owner 등급은 변경할 수 없습니다.';
  end if;
  if v_actor_role = 'operator' and v_current_role = 'operator' then
    raise exception using errcode = '42501', message = '운영자는 다른 운영자의 등급을 변경할 수 없습니다.';
  end if;
  if not public.auth_user_has_kakao_identity(p_member_id) then
    raise exception using errcode = '42501', message = 'Kakao 회원만 운영 역할로 변경할 수 있습니다.';
  end if;

  v_reports_to := case
    when v_requested_role = 'employee' and v_actor_role = 'operator' then auth.uid()
    when v_requested_role = 'employee' and v_actor_role = 'owner' then coalesce(
      (
        select roles.reports_to_operator_id
        from public.account_access_roles as roles
        where roles.user_id = p_member_id
          and roles.role_code = 'employee'
      ),
      (
        select roles.user_id
        from public.account_access_roles as roles
        where roles.role_code = 'operator'
          and public.auth_user_has_kakao_identity(roles.user_id)
        order by roles.created_at, roles.user_id
        limit 1
      )
    )
    else null
  end;

  if v_requested_role = 'employee' and v_reports_to is null then
    raise exception using
      errcode = '23514',
      message = '직원을 지정하기 전에 Kakao 운영자를 먼저 등록해 주세요.';
  end if;

  update public.account_access_roles
  set
    role_code = v_requested_role,
    reports_to_operator_id = v_reports_to
  where user_id = p_member_id;

  return v_requested_role;
end;
$$;

revoke all on function public.set_member_access_role(uuid, text) from public;
grant execute on function public.set_member_access_role(uuid, text) to authenticated;

create or replace function public.update_managed_member(
  p_member_id uuid,
  p_display_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 정보 수정 권한이 없습니다.';
  end if;
  select public.access_role_for_user(p_member_id) into v_role;
  if v_role not in ('employee', 'band_member', 'member') then
    raise exception using errcode = '42501', message = 'owner와 운영자 정보는 이 경로로 수정할 수 없습니다.';
  end if;
  if char_length(v_name) not between 1 and 80
    or (v_phone is not null and char_length(v_phone) not between 7 and 30)
  then
    raise exception using errcode = '22023', message = '회원 이름과 연락처를 확인해 주세요.';
  end if;

  update public.profiles set display_name = v_name where id = p_member_id;
  update public.member_accounts set phone = v_phone where member_id = p_member_id;
  if v_phone is not null then
    update public.shipping_addresses
    set phone = v_phone
    where member_id = p_member_id and is_default;
  end if;
end;
$$;

revoke all on function public.update_managed_member(uuid, text, text) from public;
grant execute on function public.update_managed_member(uuid, text, text) to authenticated;

create or replace function public.delete_managed_member(
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 삭제 권한이 없습니다.';
  end if;
  select public.access_role_for_user(p_member_id) into v_role;
  if v_role not in ('employee', 'band_member', 'member') then
    raise exception using errcode = '42501', message = 'owner와 운영자는 이 경로로 삭제할 수 없습니다.';
  end if;

  delete from auth.users where id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = '삭제할 회원을 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.delete_managed_member(uuid) from public;
grant execute on function public.delete_managed_member(uuid) to authenticated;

create or replace function public.set_member_account_status(
  p_member_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 상태 변경 권한이 없습니다.';
  end if;
  select public.access_role_for_user(p_member_id) into v_role;
  if v_role not in ('employee', 'band_member', 'member') then
    raise exception using errcode = '42501', message = 'owner와 운영자 상태는 변경할 수 없습니다.';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = '지원하지 않는 회원 상태입니다.';
  end if;

  update public.member_accounts set account_status = p_status where member_id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = '회원을 찾을 수 없습니다.';
  end if;
  return p_status;
end;
$$;

revoke all on function public.set_member_account_status(uuid, text) from public;
grant execute on function public.set_member_account_status(uuid, text) to authenticated;

create or replace function public.adjust_member_shipping_credits(
  p_member_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_role text;
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '배송 이용권 변경 권한이 없습니다.';
  end if;
  select public.access_role_for_user(p_member_id) into v_role;
  if v_role not in ('employee', 'band_member', 'member') then
    raise exception using errcode = '42501', message = 'owner와 운영자 이용권은 변경할 수 없습니다.';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100 then
    raise exception using errcode = '22023', message = '변경할 배송 이용권 수를 확인해 주세요.';
  end if;

  update public.member_accounts
  set shipping_credit_count = shipping_credit_count + p_delta
  where member_id = p_member_id
    and shipping_credit_count + p_delta between 0 and 10000
  returning shipping_credit_count into v_count;

  if v_count is null then
    raise exception using errcode = '22003', message = '배송 이용권 범위를 벗어났습니다.';
  end if;
  return v_count;
end;
$$;

revoke all on function public.adjust_member_shipping_credits(uuid, integer) from public;
grant execute on function public.adjust_member_shipping_credits(uuid, integer)
to authenticated;

-- Employee grade 2 can create products and upload their images, but the
-- existing update/delete functions continue to require is_staff() (0/1).
drop policy if exists "Staff insert products" on public.products;
create policy "Staff insert products"
on public.products
for insert
to authenticated
with check (
  (select public.can_manage_products())
  and created_by = (select auth.uid())
  and status in ('pending', 'active')
  and participant_count = 0
  and current_price = starting_price
  and bid_history = '[]'::jsonb
  and bid_locked_at is null
  and final_bid_id is null
  and final_bid_amount is null
);

drop policy if exists "Staff upload product images" on storage.objects;
create policy "Staff upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.can_manage_products())
  and (storage.foldername(name))[1] = 'products'
  and coalesce((storage.foldername(name))[2], '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);

drop policy if exists "Employees read pending shipping requests"
on public.shipping_requests;
create policy "Employees read pending shipping requests"
on public.shipping_requests
for select
to authenticated
using (
  (select public.is_employee())
  and status = 'requested'
);

drop policy if exists "Employees read pending shipping items"
on public.shipping_request_items;
create policy "Employees read pending shipping items"
on public.shipping_request_items
for select
to authenticated
using (
  (select public.is_employee())
  and exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = request_id
      and requests.status = 'requested'
  )
);

create or replace function public.get_pending_shipping_work()
returns table (
  request_id uuid,
  address_snapshot jsonb,
  requested_at timestamptz,
  product_ids uuid[],
  item_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 대기 조회 권한이 없습니다.';
  end if;

  return query
  select
    requests.id,
    requests.address_snapshot,
    requests.requested_at,
    array_agg(items.product_id order by items.created_at, items.product_id),
    count(items.product_id)::integer
  from public.shipping_requests as requests
  join public.shipping_request_items as items on items.request_id = requests.id
  where requests.status = 'requested'
  group by requests.id, requests.address_snapshot, requests.requested_at
  order by requests.requested_at, requests.id;
end;
$$;

revoke all on function public.get_pending_shipping_work() from public;
grant execute on function public.get_pending_shipping_work() to authenticated;

create or replace function public.mark_shipping_request_shipped(
  p_request_id uuid,
  p_courier text,
  p_tracking_number text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier text := btrim(coalesce(p_courier, ''));
  v_tracking text := btrim(coalesce(p_tracking_number, ''));
begin
  if not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 처리 권한이 없습니다.';
  end if;
  if char_length(v_courier) not between 1 and 80
    or char_length(v_tracking) not between 1 and 120
  then
    raise exception using errcode = '22023', message = '택배사와 운송장 번호를 확인해 주세요.';
  end if;

  update public.shipping_requests
  set
    status = 'shipped',
    courier = v_courier,
    tracking_number = v_tracking,
    shipped_at = clock_timestamp()
  where id = p_request_id
    and status = 'requested';

  if not found then
    raise exception using errcode = 'P0002', message = '배송 대기 요청을 찾을 수 없습니다.';
  end if;
  return 'shipped';
end;
$$;

revoke all on function public.mark_shipping_request_shipped(uuid, text, text)
from public;
grant execute on function public.mark_shipping_request_shipped(uuid, text, text)
to authenticated;

-- Revenue deliberately stores only one manually confirmed summary row per KST
-- calendar day. Auction close/winning bids are never treated as paid revenue.
create table if not exists public.daily_revenue (
  revenue_date date primary key,
  gross_amount bigint not null check (gross_amount >= 0),
  paid_order_count integer not null check (paid_order_count >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.daily_revenue enable row level security;
revoke all on public.daily_revenue from anon, authenticated;

create or replace function public.upsert_daily_revenue(
  p_revenue_date date,
  p_gross_amount bigint,
  p_paid_order_count integer
)
returns table (
  revenue_date date,
  gross_amount bigint,
  paid_order_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '매출 입력 권한이 없습니다.';
  end if;
  if p_revenue_date is null
    or p_gross_amount is null or p_gross_amount < 0
    or p_paid_order_count is null or p_paid_order_count < 0
  then
    raise exception using errcode = '22023', message = '일 매출 값을 확인해 주세요.';
  end if;

  insert into public.daily_revenue (
    revenue_date,
    gross_amount,
    paid_order_count,
    updated_at,
    updated_by
  )
  values (
    p_revenue_date,
    p_gross_amount,
    p_paid_order_count,
    clock_timestamp(),
    auth.uid()
  )
  on conflict on constraint daily_revenue_pkey do update
  set
    gross_amount = excluded.gross_amount,
    paid_order_count = excluded.paid_order_count,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return query
  select
    revenue.revenue_date,
    revenue.gross_amount,
    revenue.paid_order_count,
    revenue.updated_at
  from public.daily_revenue as revenue
  where revenue.revenue_date = p_revenue_date;
end;
$$;

revoke all on function public.upsert_daily_revenue(date, bigint, integer)
from public;
grant execute on function public.upsert_daily_revenue(date, bigint, integer)
to authenticated;

create or replace function public.get_daily_revenue(
  p_from date,
  p_to date
)
returns table (
  revenue_date date,
  gross_amount bigint,
  paid_order_count integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '매출 조회 권한이 없습니다.';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 36525 then
    raise exception using errcode = '22023', message = '매출 조회 기간을 확인해 주세요.';
  end if;

  return query
  select
    revenue.revenue_date,
    revenue.gross_amount,
    revenue.paid_order_count,
    revenue.updated_at
  from public.daily_revenue as revenue
  where revenue.revenue_date between p_from and p_to
  order by revenue.revenue_date;
end;
$$;

revoke all on function public.get_daily_revenue(date, date) from public;
grant execute on function public.get_daily_revenue(date, date) to authenticated;

create or replace function public.get_weekly_revenue(
  p_from date,
  p_to date
)
returns table (
  period_start date,
  period_end date,
  gross_amount bigint,
  paid_order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '매출 조회 권한이 없습니다.';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 36525 then
    raise exception using errcode = '22023', message = '매출 조회 기간을 확인해 주세요.';
  end if;

  return query
  select
    date_trunc('week', revenue.revenue_date::timestamp)::date,
    (date_trunc('week', revenue.revenue_date::timestamp)::date + 6),
    sum(revenue.gross_amount)::bigint,
    sum(revenue.paid_order_count)::bigint
  from public.daily_revenue as revenue
  where revenue.revenue_date between p_from and p_to
  group by date_trunc('week', revenue.revenue_date::timestamp)::date
  order by 1;
end;
$$;

revoke all on function public.get_weekly_revenue(date, date) from public;
grant execute on function public.get_weekly_revenue(date, date) to authenticated;

create or replace function public.get_monthly_revenue(
  p_from date,
  p_to date
)
returns table (
  period_start date,
  period_end date,
  gross_amount bigint,
  paid_order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '매출 조회 권한이 없습니다.';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 36525 then
    raise exception using errcode = '22023', message = '매출 조회 기간을 확인해 주세요.';
  end if;

  return query
  select
    date_trunc('month', revenue.revenue_date::timestamp)::date,
    (
      date_trunc('month', revenue.revenue_date::timestamp)
      + interval '1 month' - interval '1 day'
    )::date,
    sum(revenue.gross_amount)::bigint,
    sum(revenue.paid_order_count)::bigint
  from public.daily_revenue as revenue
  where revenue.revenue_date between p_from and p_to
  group by date_trunc('month', revenue.revenue_date::timestamp)::date
  order by 1;
end;
$$;

revoke all on function public.get_monthly_revenue(date, date) from public;
grant execute on function public.get_monthly_revenue(date, date) to authenticated;

create or replace function public.get_yearly_revenue(
  p_from date,
  p_to date
)
returns table (
  period_start date,
  period_end date,
  gross_amount bigint,
  paid_order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '매출 조회 권한이 없습니다.';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 36525 then
    raise exception using errcode = '22023', message = '매출 조회 기간을 확인해 주세요.';
  end if;

  return query
  select
    make_date(extract(year from revenue.revenue_date)::integer, 1, 1),
    make_date(extract(year from revenue.revenue_date)::integer, 12, 31),
    sum(revenue.gross_amount)::bigint,
    sum(revenue.paid_order_count)::bigint
  from public.daily_revenue as revenue
  where revenue.revenue_date between p_from and p_to
  group by extract(year from revenue.revenue_date)::integer
  order by 1;
end;
$$;

revoke all on function public.get_yearly_revenue(date, date) from public;
grant execute on function public.get_yearly_revenue(date, date) to authenticated;

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists app_private;
create schema if not exists test_support;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.test_user_id', true), '')::uuid;
$$;

create table public.profiles (
  id uuid primary key
);

create table public.account_access_roles (
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

create or replace function public.access_role_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select roles.role_code
  from public.account_access_roles as roles
  where roles.user_id = p_user_id;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.access_role_for_user(auth.uid()) = 'owner', false);
$$;

create table public.businesses (
  id uuid primary key,
  code text not null unique,
  name text not null,
  status text not null check (status in ('active', 'inactive'))
);

create table public.stores (
  id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  operator_id uuid not null references public.profiles (id) on delete restrict,
  is_active boolean not null default true,
  unique (id, business_id)
);

create or replace function public.can_manage_product_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores as stores
    where stores.id = p_store_id
      and stores.is_active
      and (
        public.is_owner()
        or stores.operator_id = auth.uid()
        or exists (
          select 1
          from public.account_access_roles as roles
          where roles.user_id = auth.uid()
            and roles.role_code = 'employee'
            and roles.reports_to_operator_id = stores.operator_id
        )
      )
  );
$$;

create or replace function test_support.assert_true(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception using errcode = 'P0001', message = p_message;
  end if;
end;
$$;

grant usage on schema public, auth, test_support
to anon, authenticated, service_role;
grant execute on function auth.uid(), public.is_owner(),
  public.access_role_for_user(uuid), public.can_manage_product_store(uuid)
to anon, authenticated, service_role;
grant execute on function test_support.assert_true(boolean, text)
to anon, authenticated, service_role;

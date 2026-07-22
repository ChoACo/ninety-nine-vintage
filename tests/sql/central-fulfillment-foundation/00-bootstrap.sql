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

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.test_is_owner', true), '')::boolean,
    false
  );
$$;

create table public.profiles (
  id uuid primary key
);

create table public.stores (
  id uuid primary key,
  operator_id uuid not null references public.profiles (id) on delete restrict
);

create table public.products (
  id uuid primary key,
  store_id uuid not null references public.stores (id) on delete restrict
);

create table public.commerce_orders (
  id uuid primary key,
  member_id uuid not null references public.profiles (id) on delete restrict,
  status text not null check (
    status in (
      'awaiting_payment',
      'partially_paid',
      'paid',
      'cancelled',
      'shipped'
    )
  )
);

create table public.commerce_order_items (
  id uuid primary key,
  order_id uuid not null references public.commerce_orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  store_id uuid references public.stores (id) on delete restrict,
  payment_status text not null check (
    payment_status in ('awaiting_payment', 'paid', 'cancelled')
  ),
  paid_at timestamptz,
  storage_expires_at timestamptz,
  unique (order_id, product_id)
);

create table public.shipping_requests (
  id uuid primary key,
  status text not null check (status in ('requested', 'shipped', 'cancelled'))
);

create table public.shipping_request_items (
  request_id uuid not null references public.shipping_requests (id) on delete restrict,
  product_id uuid not null unique references public.products (id) on delete restrict,
  primary key (request_id, product_id)
);

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
grant execute on function auth.uid(), public.is_owner()
to anon, authenticated, service_role;
grant execute on function test_support.assert_true(boolean, text)
to anon, authenticated, service_role;

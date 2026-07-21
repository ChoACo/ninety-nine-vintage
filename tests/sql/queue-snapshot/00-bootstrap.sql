create extension if not exists pgcrypto;
create extension if not exists dblink;

create schema if not exists auth;
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

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.test_is_staff', true), '')::boolean,
    false
  );
$$;

create table public.commerce_order_transfers (
  id uuid primary key,
  order_id uuid not null unique,
  member_id uuid not null,
  expected_amount bigint not null check (expected_amount > 0),
  bank_name_snapshot text not null,
  account_number_snapshot text not null,
  status text not null check (
    status in ('awaiting_transfer', 'partially_paid', 'confirmed', 'cancelled')
  ),
  requested_at timestamptz not null,
  confirmed_at timestamptz,
  confirmed_by uuid
);

create table public.manual_transfer_payment_ledger (
  id uuid primary key,
  transfer_kind text not null check (transfer_kind in ('auction', 'commerce')),
  commerce_order_transfer_id uuid references public.commerce_order_transfers (id),
  entry_type text not null check (entry_type in ('receipt', 'reversal')),
  amount bigint not null check (amount > 0),
  depositor_name text,
  memo text not null default '',
  reversal_of uuid references public.manual_transfer_payment_ledger (id),
  recorded_by uuid not null,
  created_at timestamptz not null
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

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid(), public.is_staff()
to anon, authenticated, service_role;

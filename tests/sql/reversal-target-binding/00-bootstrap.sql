create extension if not exists pgcrypto;
create extension if not exists dblink;

create schema if not exists auth;
create schema if not exists test_support;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

create or replace function auth.uid() returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('app.test_user_id', true), '')::uuid;
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(current_setting('app.test_is_staff', true), '')::boolean, false);
$$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(current_setting('app.test_is_owner', true), '')::boolean, false);
$$;
create or replace function public.is_owner_hidden_test_member(p_member_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select false;
$$;

create table public.payment_runtime_settings (
  singleton boolean primary key default true check (singleton), active_mode text not null
);
create table public.stores (id uuid primary key, operator_id uuid not null);
create table public.products (id uuid primary key, store_id uuid not null);
create table public.commerce_orders (id uuid primary key, member_id uuid not null, status text not null, updated_at timestamptz not null default clock_timestamp());
create table public.commerce_order_transfers (id uuid primary key, order_id uuid not null, expected_amount bigint not null, status text not null, confirmed_at timestamptz, confirmed_by uuid);
create table public.commerce_order_items (order_id uuid not null, product_id uuid not null, payment_status text not null default 'paid', paid_at timestamptz, storage_expires_at timestamptz);
create table public.manual_transfer_orders (id uuid primary key, product_id uuid not null, expected_amount bigint not null, purchase_offer_id uuid, buyer_id uuid not null, status text not null, confirmed_at timestamptz, confirmed_by uuid, due_at timestamptz, payment_deadline_held_at timestamptz, due_at_before_payment_hold timestamptz, offer_due_at_before_payment_hold timestamptz, updated_at timestamptz not null default clock_timestamp());
create table public.shipping_request_items (product_id uuid not null);
create table public.owner_hidden_test_members (test_user_id uuid primary key);
create table public.notifications (member_id uuid, audience_role text, kind text, title text, body text, href text);
create table public.shipping_fee_payments (id uuid primary key, member_id uuid not null, expected_amount bigint not null, status text not null, shipping_request_id uuid, confirmed_at timestamptz, confirmed_by uuid);
create table public.member_accounts (member_id uuid primary key, shipping_credit_count integer not null default 0);
create table public.shipping_credit_ledger (member_id uuid not null, delta integer not null, reason text not null, created_by uuid not null);
create table public.manual_transfer_payment_ledger (
  id uuid primary key default gen_random_uuid(), transfer_kind text not null check (transfer_kind in ('auction', 'commerce', 'shipping')),
  manual_transfer_order_id uuid, commerce_order_transfer_id uuid, shipping_fee_payment_id uuid,
  entry_type text not null check (entry_type in ('receipt', 'reversal')), amount bigint not null check (amount > 0),
  memo text not null default '', reversal_of uuid, recorded_by uuid not null, idempotency_key text, created_at timestamptz not null default clock_timestamp(),
  constraint manual_transfer_payment_ledger_idempotency_contract_check check (entry_type = 'reversal' or idempotency_key is not null)
);
create unique index manual_transfer_payment_ledger_one_reversal_idx
  on public.manual_transfer_payment_ledger (reversal_of)
  where reversal_of is not null;
create unique index manual_transfer_payment_ledger_receipt_idempotency_idx
  on public.manual_transfer_payment_ledger (recorded_by, idempotency_key)
  where entry_type = 'receipt';

create or replace function public.reverse_manual_transfer_payment(p_ledger_id uuid, p_reason text) returns jsonb language sql as $$ select '{}'::jsonb; $$;
create or replace function public.reverse_shipping_fee_payment(p_ledger_id uuid, p_reason text) returns jsonb language sql as $$ select '{}'::jsonb; $$;

create or replace function test_support.assert_true(p_condition boolean, p_message text) returns void language plpgsql set search_path = '' as $$
begin if not coalesce(p_condition, false) then raise exception using errcode = 'P0001', message = p_message; end if; end;
$$;

grant usage on schema public, auth, test_support to anon, authenticated, service_role;
grant execute on function auth.uid(), public.is_staff(), public.is_owner(), public.is_owner_hidden_test_member(uuid) to anon, authenticated, service_role;
grant execute on function test_support.assert_true(boolean, text) to anon, authenticated, service_role;

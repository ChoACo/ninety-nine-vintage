-- Production-schema prerequisites intentionally omitted by the focused central
-- fulfillment bootstrap.  These are the smallest pre-60000 representations of
-- the established commerce payment and address contracts that 60000/70000 lock
-- or reference; the canonical migrations themselves are always applied by the
-- runner with psql -f.
alter table public.commerce_orders
  add column total bigint not null default 10000 check (total > 0),
  add column updated_at timestamptz not null default clock_timestamp();
alter table public.commerce_order_items
  add column unit_price bigint not null default 10000 check (unit_price > 0);
alter table public.shipping_requests
  add column member_id uuid references public.profiles (id) on delete restrict,
  add column address_id uuid,
  add column address_snapshot jsonb,
  add column idempotency_key text,
  add column courier text,
  add column tracking_number text,
  add column shipped_at timestamptz;
alter table public.shipping_requests
  alter column status set default 'requested';

create table public.member_accounts (
  member_id uuid primary key references public.profiles (id) on delete restrict,
  account_status text not null default 'active',
  shipping_credit_count integer not null default 0
);
create table public.shipping_addresses (
  id uuid primary key,
  member_id uuid not null references public.profiles (id) on delete restrict,
  label text not null,
  recipient_name text not null,
  phone text not null,
  postal_code text not null,
  address text not null
);
alter table public.shipping_requests
  add constraint shipping_requests_address_fkey
  foreign key (address_id) references public.shipping_addresses (id) on delete restrict;

create table public.commerce_order_transfers (
  id uuid primary key,
  order_id uuid not null unique references public.commerce_orders (id) on delete restrict,
  member_id uuid not null references public.profiles (id) on delete restrict,
  expected_amount bigint not null check (expected_amount > 0),
  status text not null check (status in ('awaiting_transfer', 'partially_paid', 'confirmed', 'cancelled')),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete restrict
);
create table public.shipping_fee_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  shipping_request_id uuid references public.shipping_requests (id) on delete restrict,
  expected_amount bigint not null check (expected_amount > 0),
  status text not null default 'awaiting_transfer' check (status in ('awaiting_transfer', 'partially_paid', 'confirmed', 'cancelled')),
  bank_name_snapshot text,
  account_number_snapshot text,
  idempotency_key text,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete restrict
);
create table public.shipping_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text not null,
  shipping_request_id uuid references public.shipping_requests (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete restrict
);
create table public.manual_transfer_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  transfer_kind text not null check (transfer_kind in ('commerce', 'shipping')),
  commerce_order_transfer_id uuid references public.commerce_order_transfers (id) on delete restrict,
  shipping_fee_payment_id uuid references public.shipping_fee_payments (id) on delete restrict,
  entry_type text not null check (entry_type in ('receipt', 'reversal')),
  amount bigint not null check (amount > 0),
  depositor_name text,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (transfer_kind = 'commerce' and commerce_order_transfer_id is not null and shipping_fee_payment_id is null)
    or (transfer_kind = 'shipping' and shipping_fee_payment_id is not null and commerce_order_transfer_id is null)
  )
);

-- These production compatibility entry points are deliberately present before
-- 70000 so the migration proves that it removes their executable surface.
create function public.request_product_shipping(uuid[], uuid, boolean, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.request_product_shipping(uuid[], uuid, boolean) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.request_product_shipping(uuid[], uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.mark_shipping_request_shipped(uuid, text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.upsert_shipping_tracking_batch(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.get_shipping_work(boolean, integer, integer) returns table(id uuid) language sql as $$ select null::uuid where false $$;
create function public.get_pending_shipping_work() returns table(id uuid) language sql as $$ select null::uuid where false $$;
create function public.count_shipping_work(boolean) returns integer language sql as $$ select 0 $$;
create function public.owner_mark_hidden_test_shipping_shipped(uuid, text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.owner_request_hidden_test_shipping(uuid[], uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;

create or replace function test_support.expect_sqlstate(
  p_statement text, p_expected_state text, p_message text
) returns void language plpgsql set search_path = '' as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlstate = p_expected_state then return; end if;
    raise exception using errcode = 'P0001', message = p_message || ' (expected ' || p_expected_state || ', received ' || sqlstate || ': ' || sqlerrm || ')';
  end;
  raise exception using errcode = 'P0001', message = p_message || ' (statement unexpectedly succeeded)';
end;
$$;
grant execute on function test_support.expect_sqlstate(text, text, text)
to anon, authenticated, service_role;

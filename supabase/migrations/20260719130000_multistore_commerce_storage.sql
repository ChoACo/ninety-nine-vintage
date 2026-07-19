-- NINETY-NINE VINTAGE: multi-store commerce, storage and shipping credits.
-- Existing auction and payment ledgers remain authoritative for auction wins.

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '',
  operator_id uuid not null references public.profiles (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column if not exists store_id uuid references public.stores (id) on delete restrict,
  add column if not exists storage_class text not null default 'small',
  add column if not exists size_label text not null default '',
  add column if not exists condition_grade text not null default 'A',
  add column if not exists measurements jsonb not null default '{}'::jsonb,
  add column if not exists inspection_notes text[] not null default '{}';

alter table public.products drop constraint if exists products_storage_class_check;
alter table public.products add constraint products_storage_class_check check (storage_class in ('small', 'large'));
alter table public.products drop constraint if exists products_condition_grade_check;
alter table public.products add constraint products_condition_grade_check check (condition_grade in ('S', 'A+', 'A', 'B'));

create index if not exists products_store_public_idx on public.products (store_id, status, publish_at desc);

create table if not exists public.cart_items (
  member_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, product_id)
);

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'partially_paid', 'cancelled', 'shipped')),
  subtotal bigint not null check (subtotal >= 0),
  shipping_fee bigint not null default 0 check (shipping_fee >= 0),
  total bigint not null check (total = subtotal + shipping_fee),
  shipping_credit_applied boolean not null default false,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, idempotency_key)
);

create table if not exists public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  store_id uuid references public.stores (id) on delete restrict,
  unit_price bigint not null check (unit_price > 0),
  payment_status text not null default 'awaiting_payment' check (payment_status in ('awaiting_payment', 'paid', 'cancelled')),
  paid_at timestamptz,
  storage_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists commerce_order_items_storage_idx on public.commerce_order_items (order_id, storage_expires_at, payment_status);

create table if not exists public.shipping_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('prepaid', 'grant', 'used', 'refund', 'adjustment')),
  order_id uuid references public.commerce_orders (id) on delete set null,
  shipping_request_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shipping_fee_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  shipping_request_id uuid,
  expected_amount bigint not null check (expected_amount > 0),
  status text not null default 'awaiting_transfer' check (status in ('awaiting_transfer', 'confirmed', 'cancelled')),
  bank_name_snapshot text,
  account_number_snapshot text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.profiles (id) on delete cascade,
  audience_role text not null default 'member' check (audience_role in ('member', 'operator', 'owner')),
  kind text not null,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.stores enable row level security;
alter table public.cart_items enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.shipping_credit_ledger enable row level security;
alter table public.shipping_fee_payments enable row level security;
alter table public.notifications enable row level security;

create policy "Public reads active stores" on public.stores for select to anon, authenticated using (is_active);
create policy "Members manage their cart" on public.cart_items for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "Members read their commerce orders" on public.commerce_orders for select to authenticated using (member_id = auth.uid() or public.is_staff());
create policy "Members read their commerce items" on public.commerce_order_items for select to authenticated using (exists (select 1 from public.commerce_orders orders where orders.id = order_id and (orders.member_id = auth.uid() or public.is_staff())));
create policy "Members read their shipping credits" on public.shipping_credit_ledger for select to authenticated using (member_id = auth.uid() or public.is_staff());
create policy "Members read their shipping payments" on public.shipping_fee_payments for select to authenticated using (member_id = auth.uid() or public.is_staff());
create policy "Members read their notifications" on public.notifications for select to authenticated using (member_id = auth.uid() or (audience_role = 'operator' and public.is_staff()) or (audience_role = 'owner' and public.is_owner()));

comment on table public.commerce_orders is 'Cross-store fixed-price orders. Auction settlement remains in auction_purchase_offers/manual_transfer_orders.';
comment on column public.products.storage_class is 'small: 14 days after payment, large: 7 days after payment';


-- Real member delivery data, staff member directory, and constrained product
-- management for the operator center.

create table if not exists public.member_accounts (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  phone text check (phone is null or char_length(btrim(phone)) between 7 and 30),
  shipping_credit_count integer not null default 0
    check (shipping_credit_count between 0 and 10000),
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_member_accounts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_member_accounts_updated_at() from public;

drop trigger if exists member_accounts_set_updated_at on public.member_accounts;
create trigger member_accounts_set_updated_at
before update on public.member_accounts
for each row execute function public.set_member_accounts_updated_at();

insert into public.member_accounts (member_id)
select profiles.id
from public.profiles as profiles
on conflict (member_id) do nothing;

create or replace function public.ensure_member_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_accounts (member_id)
  values (new.id)
  on conflict (member_id) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_member_account() from public;

drop trigger if exists profiles_ensure_member_account on public.profiles;
create trigger profiles_ensure_member_account
after insert on public.profiles
for each row execute function public.ensure_member_account();

alter table public.member_accounts enable row level security;
revoke all on public.member_accounts from anon, authenticated;
grant select on public.member_accounts to authenticated;

drop policy if exists "Members read their delivery account" on public.member_accounts;
create policy "Members read their delivery account"
on public.member_accounts
for select
to authenticated
using (member_id = (select auth.uid()));

create table if not exists public.shipping_addresses (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 40),
  recipient_name text not null
    check (char_length(btrim(recipient_name)) between 1 and 80),
  phone text not null check (char_length(btrim(phone)) between 7 and 30),
  address text not null check (char_length(btrim(address)) between 5 and 500),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shipping_addresses_one_default_per_member_idx
  on public.shipping_addresses (member_id)
  where is_default;
create index if not exists shipping_addresses_member_idx
  on public.shipping_addresses (member_id, created_at);

create or replace function public.set_shipping_addresses_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_shipping_addresses_updated_at() from public;

drop trigger if exists shipping_addresses_set_updated_at on public.shipping_addresses;
create trigger shipping_addresses_set_updated_at
before update on public.shipping_addresses
for each row execute function public.set_shipping_addresses_updated_at();

alter table public.shipping_addresses enable row level security;
revoke all on public.shipping_addresses from anon, authenticated;
grant select on public.shipping_addresses to authenticated;

drop policy if exists "Members read their shipping addresses" on public.shipping_addresses;
create policy "Members read their shipping addresses"
on public.shipping_addresses
for select
to authenticated
using (
  member_id = (select auth.uid())
  and (select public.is_member())
);

create or replace function public.upsert_my_shipping_address(
  p_id uuid,
  p_label text,
  p_recipient_name text,
  p_phone text,
  p_address text,
  p_is_default boolean default false
)
returns setof public.shipping_addresses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_address_id uuid := coalesce(p_id, gen_random_uuid());
  v_make_default boolean;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  perform 1
  from public.member_accounts as accounts
  where accounts.member_id = v_user_id
  for update;

  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 40
    or char_length(btrim(coalesce(p_recipient_name, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_phone, ''))) not between 7 and 30
    or char_length(btrim(coalesce(p_address, ''))) not between 5 and 500
  then
    raise exception using errcode = '22023', message = '배송지 입력값을 확인해 주세요.';
  end if;

  if p_id is not null and not exists (
    select 1 from public.shipping_addresses as addresses
    where addresses.id = p_id and addresses.member_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = '수정할 배송지를 찾을 수 없습니다.';
  end if;

  v_make_default := coalesce(p_is_default, false) or not exists (
    select 1 from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id
  );

  if v_make_default then
    update public.shipping_addresses
    set is_default = false
    where member_id = v_user_id and is_default;
  end if;

  insert into public.shipping_addresses (
    id, member_id, label, recipient_name, phone, address, is_default
  )
  values (
    v_address_id,
    v_user_id,
    btrim(p_label),
    btrim(p_recipient_name),
    btrim(p_phone),
    btrim(p_address),
    v_make_default
  )
  on conflict (id) do update
  set
    label = excluded.label,
    recipient_name = excluded.recipient_name,
    phone = excluded.phone,
    address = excluded.address,
    is_default = excluded.is_default
  where public.shipping_addresses.member_id = v_user_id;

  -- Keep one usable default address even when the previous default is edited
  -- without explicitly checking the default option.
  if not exists (
    select 1 from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id and addresses.is_default
  ) then
    update public.shipping_addresses
    set is_default = true
    where id = (
      select addresses.id
      from public.shipping_addresses as addresses
      where addresses.member_id = v_user_id
      order by addresses.created_at, addresses.id
      limit 1
    );
  end if;

  update public.member_accounts
  set phone = (
    select addresses.phone
    from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id and addresses.is_default
    limit 1
  )
  where member_id = v_user_id;

  return query
  select addresses.*
  from public.shipping_addresses as addresses
  where addresses.id = v_address_id and addresses.member_id = v_user_id;
end;
$$;

revoke all on function public.upsert_my_shipping_address(uuid, text, text, text, text, boolean) from public;
grant execute on function public.upsert_my_shipping_address(uuid, text, text, text, text, boolean)
  to authenticated;

create or replace function public.delete_my_shipping_address(
  p_address_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_was_default boolean;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  perform 1
  from public.member_accounts as accounts
  where accounts.member_id = v_user_id
  for update;

  delete from public.shipping_addresses
  where id = p_address_id and member_id = v_user_id
  returning is_default into v_was_default;

  if not found then
    raise exception using errcode = 'P0002', message = '삭제할 배송지를 찾을 수 없습니다.';
  end if;

  if v_was_default then
    update public.shipping_addresses
    set is_default = true
    where id = (
      select addresses.id
      from public.shipping_addresses as addresses
      where addresses.member_id = v_user_id
      order by addresses.created_at, addresses.id
      limit 1
    );
  end if;

  update public.member_accounts
  set phone = (
    select addresses.phone
    from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id and addresses.is_default
    limit 1
  )
  where member_id = v_user_id;
end;
$$;

revoke all on function public.delete_my_shipping_address(uuid) from public;
grant execute on function public.delete_my_shipping_address(uuid) to authenticated;

-- Suspended users keep their data but immediately lose member RPC/RLS access,
-- including with an already-issued JWT.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      (
        (auth.jwt() -> 'app_metadata' ->> 'role') is null
        or (auth.jwt() -> 'app_metadata' ->> 'role') = 'member'
      )
      and (
        (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kakao'
        or (auth.jwt() -> 'app_metadata' -> 'providers') ? 'kakao'
      )
      and exists (
        select 1
        from public.member_accounts as accounts
        where accounts.member_id = auth.uid()
          and accounts.account_status = 'active'
      )
    ),
    false
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

create table if not exists public.shipping_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  address_id uuid references public.shipping_addresses (id) on delete set null,
  address_snapshot jsonb not null check (jsonb_typeof(address_snapshot) = 'object'),
  status text not null default 'requested'
    check (status in ('requested', 'shipped')),
  courier text,
  tracking_number text,
  requested_at timestamptz not null default now(),
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shipping_requests
  drop constraint if exists shipping_requests_status_details_check;
alter table public.shipping_requests
  add constraint shipping_requests_status_details_check
  check (
    (
      status = 'requested'
      and courier is null
      and tracking_number is null
      and shipped_at is null
    )
    or
    (
      status = 'shipped'
      and char_length(btrim(courier)) between 1 and 80
      and char_length(btrim(tracking_number)) between 1 and 120
      and shipped_at is not null
    )
  );

create table if not exists public.shipping_request_items (
  request_id uuid not null references public.shipping_requests (id) on delete restrict,
  product_id uuid not null unique references public.products (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (request_id, product_id)
);

create or replace function public.set_shipping_requests_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_shipping_requests_updated_at() from public;

drop trigger if exists shipping_requests_set_updated_at on public.shipping_requests;
create trigger shipping_requests_set_updated_at
before update on public.shipping_requests
for each row execute function public.set_shipping_requests_updated_at();

create index if not exists shipping_requests_member_idx
  on public.shipping_requests (member_id, requested_at desc);

alter table public.shipping_requests enable row level security;
alter table public.shipping_request_items enable row level security;
revoke all on public.shipping_requests, public.shipping_request_items from anon, authenticated;
grant select on public.shipping_requests, public.shipping_request_items to authenticated;

drop policy if exists "Members read their shipping requests and staff read all"
  on public.shipping_requests;
create policy "Members read their shipping requests and staff read all"
on public.shipping_requests
for select
to authenticated
using (
  (member_id = (select auth.uid()) and (select public.is_member()))
  or (select public.is_staff())
);

drop policy if exists "Members read their shipping items and staff read all"
  on public.shipping_request_items;
create policy "Members read their shipping items and staff read all"
on public.shipping_request_items
for select
to authenticated
using (
  exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = request_id
      and (
        (requests.member_id = (select auth.uid()) and (select public.is_member()))
        or (select public.is_staff())
      )
  )
);

create or replace function public.get_my_won_products()
returns table (
  product_id uuid,
  title text,
  image_urls text[],
  closed_at timestamptz,
  final_bid_amount bigint,
  shipping_status text,
  shipment_request_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  return query
  select
    products.id,
    products.title,
    products.image_urls,
    products.closes_at,
    winner.amount,
    case
      when requests.status = 'shipped' then 'shipped'
      when requests.id is not null then 'requested'
      else 'ready'
    end,
    requests.id
  from public.products as products
  join lateral (
    select bids.bidder_id, bids.amount
    from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1
  ) as winner on true
  left join public.shipping_request_items as items
    on items.product_id = products.id
  left join public.shipping_requests as requests
    on requests.id = items.request_id
  where winner.bidder_id = v_user_id
    and products.status = 'closed'
  order by products.closes_at desc;
end;
$$;

revoke all on function public.get_my_won_products() from public;
grant execute on function public.get_my_won_products() to authenticated;

create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_credit_count integer;
  v_address public.shipping_addresses%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_valid_count integer;
  v_distinct_count integer;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) < 1 or cardinality(p_product_ids) > 100 then
    raise exception using errcode = '22023', message = '택배 접수할 상품을 선택해 주세요.';
  end if;

  select count(distinct product_id)
  into v_distinct_count
  from unnest(p_product_ids) as selected(product_id);
  if v_distinct_count <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = '중복된 상품 선택이 있습니다.';
  end if;

  select accounts.shipping_credit_count
  into v_credit_count
  from public.member_accounts as accounts
  where accounts.member_id = v_user_id
  for update;
  if v_credit_count is null or v_credit_count < 1 then
    raise exception using errcode = 'P0001', message = '택배 가능 횟수가 부족합니다.';
  end if;

  select addresses.*
  into v_address
  from public.shipping_addresses as addresses
  where addresses.id = p_address_id and addresses.member_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;

  select count(*)
  into v_valid_count
  from public.products as products
  join lateral (
    select bids.bidder_id
    from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1
  ) as winner on true
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and winner.bidder_id = v_user_id
    and not exists (
      select 1
      from public.shipping_request_items as items
      where items.product_id = products.id
    );
  if v_valid_count <> cardinality(p_product_ids) then
    raise exception using errcode = '42501', message = '접수할 수 없는 상품이 포함되어 있습니다.';
  end if;

  insert into public.shipping_requests (
    id, member_id, address_id, address_snapshot
  )
  values (
    v_request_id,
    v_user_id,
    v_address.id,
    jsonb_build_object(
      'label', v_address.label,
      'recipientName', v_address.recipient_name,
      'phone', v_address.phone,
      'address', v_address.address
    )
  );

  insert into public.shipping_request_items (request_id, product_id)
  select v_request_id, selected.product_id
  from unnest(p_product_ids) as selected(product_id);

  update public.member_accounts
  set shipping_credit_count = shipping_credit_count - 1
  where member_id = v_user_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_product_shipping(uuid[], uuid) from public;
grant execute on function public.request_product_shipping(uuid[], uuid) to authenticated;

-- The three explicitly provisioned operators and the existing administrator
-- can inspect the complete member directory needed for support and shipping.
create or replace function public.get_staff_member_directory(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id uuid,
  display_name text,
  email text,
  phone text,
  account_status text,
  shipping_credit_count integer,
  address_count bigint,
  bid_count bigint,
  support_status text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
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
    users.email::text,
    accounts.phone,
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
    ),
    profiles.created_at,
    users.last_sign_in_at
  from public.profiles as profiles
  join auth.users as users on users.id = profiles.id
  join public.member_accounts as accounts on accounts.member_id = profiles.id
  where (
    users.raw_app_meta_data -> 'providers' ? 'kakao'
    or users.raw_app_meta_data ->> 'provider' = 'kakao'
  )
    and coalesce(users.raw_app_meta_data ->> 'role', 'member') = 'member'
  order by profiles.created_at desc, profiles.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_staff_member_directory(integer, integer) from public;
grant execute on function public.get_staff_member_directory(integer, integer) to authenticated;

create or replace function public.set_member_account_status(
  p_member_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '관리자만 회원 상태를 변경할 수 있습니다.';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = '지원하지 않는 회원 상태입니다.';
  end if;

  update public.member_accounts
  set account_status = p_status
  where member_id = p_member_id;
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
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '관리자만 택배 횟수를 변경할 수 있습니다.';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100 then
    raise exception using errcode = '22023', message = '변경할 택배 횟수를 확인해 주세요.';
  end if;

  update public.member_accounts
  set shipping_credit_count = shipping_credit_count + p_delta
  where member_id = p_member_id
    and shipping_credit_count + p_delta between 0 and 10000
  returning shipping_credit_count into v_count;
  if v_count is null then
    raise exception using errcode = '22003', message = '택배 가능 횟수 범위를 벗어났습니다.';
  end if;
  return v_count;
end;
$$;

revoke all on function public.adjust_member_shipping_credits(uuid, integer) from public;
grant execute on function public.adjust_member_shipping_credits(uuid, integer) to authenticated;

-- Product creation is available to the three linked operators and the existing
-- administrator. Derived bid fields remain writable only by server functions.
alter table public.products
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;
alter table public.products alter column created_by set default auth.uid();

create or replace function public.set_products_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = greatest(
    clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

revoke all on function public.set_products_updated_at() from public;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_title_length_check'
  ) then
    alter table public.products
      add constraint products_title_length_check
      check (char_length(btrim(title)) between 1 and 160);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_description_length_check'
  ) then
    alter table public.products
      add constraint products_description_length_check
      check (char_length(btrim(description)) between 1 and 10000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_publish_before_close_check'
  ) then
    alter table public.products
      add constraint products_publish_before_close_check
      check (closes_at > publish_at);
  end if;
end;
$$;

drop policy if exists "Admins read every product" on public.products;
drop policy if exists "Admins insert products" on public.products;
drop policy if exists "Admins update products" on public.products;
drop policy if exists "Admins delete products" on public.products;
drop policy if exists "Staff read every product" on public.products;
drop policy if exists "Staff insert products" on public.products;

create policy "Staff read every product"
on public.products
for select
to authenticated
using ((select public.is_staff()));

create policy "Staff insert products"
on public.products
for insert
to authenticated
with check (
  (select public.is_staff())
  and created_by = (select auth.uid())
  and status in ('pending', 'active')
  and participant_count = 0
  and current_price = starting_price
  and bid_history = '[]'::jsonb
  and bid_locked_at is null
  and final_bid_id is null
  and final_bid_amount is null
);

revoke update, delete on public.products from authenticated;
grant select, insert on public.products to authenticated;

create or replace function public.update_managed_product(
  p_product_id uuid,
  p_title text,
  p_description text,
  p_starting_price bigint,
  p_bid_increment bigint,
  p_status text,
  p_publish_at timestamptz,
  p_expected_updated_at timestamptz
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_has_bids boolean;
  v_kst_date date;
  v_kst_time time;
  v_closes_at timestamptz;
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_description, ''))) not between 1 and 10000
    or p_starting_price not between 1 and 1000000000
    or p_bid_increment not between 1 and 100000000
    or p_status not in ('pending', 'active', 'closed')
    or p_publish_at is null
    or p_expected_updated_at is null
  then
    raise exception using errcode = '22023', message = '상품 수정 값을 확인해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = '다른 운영자가 먼저 수정했습니다. 목록을 새로고침해 주세요.';
  end if;

  select exists (
    select 1 from public.auction_bids as bids where bids.product_id = p_product_id
  ) into v_has_bids;
  if v_has_bids and (
    p_starting_price <> v_product.starting_price
    or p_bid_increment <> v_product.bid_increment
  ) then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품의 가격은 변경할 수 없습니다.';
  end if;
  if v_has_bids and (
    btrim(p_title) <> v_product.title
    or btrim(p_description) <> v_product.description
  ) then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품의 제목과 설명은 변경할 수 없습니다.';
  end if;
  if v_has_bids and p_publish_at <> v_product.publish_at then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품의 공개 시각은 변경할 수 없습니다.';
  end if;
  if v_has_bids and p_status = 'pending' then
    raise exception using errcode = 'P0001', message = '입찰이 시작된 상품은 공개 대기 상태로 되돌릴 수 없습니다.';
  end if;
  if v_has_bids and v_product.status = 'closed' and p_status <> 'closed' then
    raise exception using errcode = 'P0001', message = '마감된 입찰 상품은 다시 열 수 없습니다.';
  end if;

  v_kst_date := (p_publish_at at time zone 'Asia/Seoul')::date;
  v_kst_time := (p_publish_at at time zone 'Asia/Seoul')::time;
  v_closes_at := (
    v_kst_date + case when v_kst_time >= time '21:00:00' then 1 else 0 end
    + time '21:00:00'
  ) at time zone 'Asia/Seoul';

  update public.products
  set
    title = btrim(p_title),
    description = btrim(p_description),
    starting_price = p_starting_price,
    current_price = case when v_has_bids then current_price else p_starting_price end,
    bid_increment = p_bid_increment,
    status = p_status,
    publish_at = p_publish_at,
    closes_at = v_closes_at,
    updated_by = auth.uid()
  where id = p_product_id;

  return query select products.* from public.products as products
  where products.id = p_product_id;
end;
$$;

revoke all on function public.update_managed_product(uuid, text, text, bigint, bigint, text, timestamptz, timestamptz) from public;
grant execute on function public.update_managed_product(uuid, text, text, bigint, bigint, text, timestamptz, timestamptz)
  to authenticated;

create or replace function public.delete_managed_product(
  p_product_id uuid,
  p_expected_updated_at timestamptz
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_image_urls text[];
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = '상품 수정 버전이 필요합니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '삭제할 상품을 찾을 수 없습니다.';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = '다른 운영자가 먼저 수정했습니다. 목록을 새로고침해 주세요.';
  end if;

  if exists (
    select 1 from public.auction_bids as bids where bids.product_id = p_product_id
  ) then
    raise exception using errcode = 'P0001', message = '입찰 기록이 있는 상품은 삭제할 수 없습니다. 마감 상태로 변경해 주세요.';
  end if;

  v_image_urls := v_product.image_urls;
  delete from public.products where id = p_product_id;
  return v_image_urls;
end;
$$;

revoke all on function public.delete_managed_product(uuid, timestamptz) from public;
grant execute on function public.delete_managed_product(uuid, timestamptz) to authenticated;

drop policy if exists "Admins upload product images" on storage.objects;
drop policy if exists "Admins update product images" on storage.objects;
drop policy if exists "Admins delete product images" on storage.objects;
drop policy if exists "Staff upload product images" on storage.objects;
drop policy if exists "Staff update product images" on storage.objects;
drop policy if exists "Staff delete product images" on storage.objects;

create policy "Staff upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.is_staff())
  and (storage.foldername(name))[1] = 'products'
  and coalesce((storage.foldername(name))[2], '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);

create policy "Staff delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_staff())
  and case
    when (storage.foldername(name))[1] = 'products'
      and coalesce((storage.foldername(name))[2], '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then not exists (
      select 1
      from public.products as products
      where products.id = ((storage.foldername(name))[2])::uuid
    )
    else false
  end
);

do $$
begin
  alter publication supabase_realtime add table public.member_accounts;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.shipping_addresses;
exception when duplicate_object then null;
end;
$$;

-- Auth-backed member profiles, staff support chat, and the authoritative bid ledger.
-- This migration never writes auth.users.raw_app_meta_data, so an existing
-- app_metadata.role = 'admin' account remains an administrator.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 80),
  avatar_url text
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_profiles_updated_at() from public;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profiles_updated_at();

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_avatar_url text;
begin
  v_display_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'preferred_username'), ''),
      '회원-' || left(new.id::text, 6)
    ),
    80
  );
  v_avatar_url := nullif(
    left(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'avatar_url',
          new.raw_user_meta_data ->> 'picture',
          ''
        )
      ),
      2048
    ),
    ''
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_display_name, v_avatar_url)
  on conflict (id) do update
  set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url;

  return new;
end;
$$;

revoke all on function public.sync_auth_user_profile() from public;

drop trigger if exists auth_user_sync_profile on auth.users;
create trigger auth_user_sync_profile
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_profile();

-- Backfill all existing users without altering their server-managed app_metadata.
insert into public.profiles (id, display_name, avatar_url, created_at, updated_at)
select
  users.id,
  left(
    coalesce(
      nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'preferred_username'), ''),
      '회원-' || left(users.id::text, 6)
    ),
    80
  ),
  nullif(
    left(
      btrim(
        coalesce(
          users.raw_user_meta_data ->> 'avatar_url',
          users.raw_user_meta_data ->> 'picture',
          ''
        )
      ),
      2048
    ),
    ''
  ),
  coalesce(users.created_at, now()),
  now()
from auth.users as users
on conflict (id) do nothing;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator'),
    false
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Members read their own profile" on public.profiles;
create policy "Members read their own profile"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "Staff read member profiles" on public.profiles;
create policy "Staff read member profiles"
on public.profiles
for select
to authenticated
using ((select public.is_staff()));

-- These rows reserve stable login IDs. Passwords and Auth users are provisioned
-- later through a trusted server using app_metadata.role = 'operator'.
create table if not exists public.operator_accounts (
  username text primary key
    check (username ~ '^[a-z][a-z0-9_-]{2,31}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 80),
  auth_user_id uuid unique references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.operator_accounts (username, display_name)
values
  ('operator01', '운영자 1'),
  ('operator02', '운영자 2'),
  ('operator03', '운영자 3')
on conflict (username) do nothing;

create or replace function public.set_operator_accounts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_operator_accounts_updated_at() from public;

drop trigger if exists operator_accounts_set_updated_at on public.operator_accounts;
create trigger operator_accounts_set_updated_at
before update on public.operator_accounts
for each row execute function public.set_operator_accounts_updated_at();

create or replace function public.validate_operator_account_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.auth_user_id is not null and not exists (
    select 1
    from auth.users as users
    where users.id = new.auth_user_id
      and users.raw_app_meta_data ->> 'role' = 'operator'
  ) then
    raise exception using
      errcode = '23514',
      message = '운영자 슬롯에는 operator 권한의 Auth 사용자만 연결할 수 있습니다.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_operator_account_user() from public;

drop trigger if exists operator_accounts_validate_user on public.operator_accounts;
create trigger operator_accounts_validate_user
before insert or update of auth_user_id on public.operator_accounts
for each row execute function public.validate_operator_account_user();

alter table public.operator_accounts enable row level security;
revoke all on public.operator_accounts from anon, authenticated;
grant select on public.operator_accounts to authenticated;
grant update (auth_user_id, display_name) on public.operator_accounts to authenticated;

drop policy if exists "Admins manage operator slots" on public.operator_accounts;
create policy "Admins manage operator slots"
on public.operator_accounts
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.profiles (id) on delete cascade,
  assigned_staff_id uuid references public.profiles (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'closed')),
  last_message_at timestamptz,
  last_message_preview text
    check (last_message_preview is null or char_length(last_message_preview) <= 160),
  last_sender_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_conversations_inbox_idx
  on public.support_conversations (status, last_message_at desc nulls last);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.support_conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text not null
    check (char_length(btrim(body)) between 1 and 2000),
  client_nonce uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (sender_id, client_nonce)
);

create index if not exists support_messages_conversation_idx
  on public.support_messages (conversation_id, created_at, id);

create table if not exists public.support_reads (
  conversation_id uuid not null
    references public.support_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create or replace function public.set_support_conversations_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_support_conversations_updated_at() from public;

drop trigger if exists support_conversations_set_updated_at
  on public.support_conversations;
create trigger support_conversations_set_updated_at
before update on public.support_conversations
for each row execute function public.set_support_conversations_updated_at();

create or replace function public.validate_support_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_staff_id is not null and not exists (
    select 1
    from auth.users as users
    where users.id = new.assigned_staff_id
      and users.raw_app_meta_data ->> 'role' in ('admin', 'operator')
  ) then
    raise exception using
      errcode = '23514',
      message = '상담은 관리자 또는 운영자에게만 배정할 수 있습니다.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_support_assignment() from public;

drop trigger if exists support_conversations_validate_assignment
  on public.support_conversations;
create trigger support_conversations_validate_assignment
before insert or update of assigned_staff_id on public.support_conversations
for each row execute function public.validate_support_assignment();

create or replace function public.refresh_support_conversation_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations
  set
    last_message_at = new.created_at,
    last_message_preview = left(
      regexp_replace(btrim(new.body), '[[:space:]]+', ' ', 'g'),
      160
    ),
    last_sender_id = new.sender_id
  where id = new.conversation_id;

  return new;
end;
$$;

revoke all on function public.refresh_support_conversation_summary() from public;

drop trigger if exists support_messages_refresh_conversation
  on public.support_messages;
create trigger support_messages_refresh_conversation
after insert on public.support_messages
for each row execute function public.refresh_support_conversation_summary();

create or replace function public.can_access_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and (
        conversations.member_id = auth.uid()
        or public.is_staff()
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid) from public;
grant execute on function public.can_access_support_conversation(uuid)
  to authenticated;

create or replace function public.get_or_create_support_conversation()
returns setof public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = '로그인 후 운영팀에 문의할 수 있습니다.';
  end if;

  if public.is_staff() then
    raise exception using
      errcode = '42501',
      message = '관리자와 운영자는 상담함에서 회원 대화를 선택해 주세요.';
  end if;

  if not exists (
    select 1 from public.profiles as profiles where profiles.id = v_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  insert into public.support_conversations (member_id)
  values (v_user_id)
  on conflict (member_id) do nothing;

  return query
  select conversations.*
  from public.support_conversations as conversations
  where conversations.member_id = v_user_id;
end;
$$;

revoke all on function public.get_or_create_support_conversation() from public;
grant execute on function public.get_or_create_support_conversation()
  to authenticated;

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_reads enable row level security;

revoke all on public.support_conversations from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;
revoke all on public.support_reads from anon, authenticated;

grant select on public.support_conversations to authenticated;
grant update (assigned_staff_id, status)
  on public.support_conversations to authenticated;
grant select on public.support_messages to authenticated;
grant insert (conversation_id, sender_id, body, client_nonce)
  on public.support_messages to authenticated;
grant select, insert on public.support_reads to authenticated;
grant update (last_read_at) on public.support_reads to authenticated;

drop policy if exists "Members read their conversation and staff read all"
  on public.support_conversations;
create policy "Members read their conversation and staff read all"
on public.support_conversations
for select
to authenticated
using (
  member_id = (select auth.uid())
  or (select public.is_staff())
);

drop policy if exists "Staff manage support conversations"
  on public.support_conversations;
create policy "Staff manage support conversations"
on public.support_conversations
for update
to authenticated
using ((select public.is_staff()))
with check ((select public.is_staff()));

drop policy if exists "Conversation participants read messages"
  on public.support_messages;
create policy "Conversation participants read messages"
on public.support_messages
for select
to authenticated
using ((select public.can_access_support_conversation(conversation_id)));

drop policy if exists "Conversation participants append messages"
  on public.support_messages;
create policy "Conversation participants append messages"
on public.support_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = conversation_id
      and conversations.status = 'open'
      and (
        conversations.member_id = (select auth.uid())
        or (select public.is_staff())
      )
  )
);

drop policy if exists "Users read their receipts and staff read all"
  on public.support_reads;
create policy "Users read their receipts and staff read all"
on public.support_reads
for select
to authenticated
using (
  (
    user_id = (select auth.uid())
    and (select public.can_access_support_conversation(conversation_id))
  )
  or (select public.is_staff())
);

drop policy if exists "Users create their own receipts"
  on public.support_reads;
create policy "Users create their own receipts"
on public.support_reads
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.can_access_support_conversation(conversation_id))
);

drop policy if exists "Users update their own receipts"
  on public.support_reads;
create policy "Users update their own receipts"
on public.support_reads
for update
to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_access_support_conversation(conversation_id))
)
with check (
  user_id = (select auth.uid())
  and (select public.can_access_support_conversation(conversation_id))
);

alter table public.products
  add column if not exists bid_locked_at timestamptz,
  add column if not exists final_bid_amount bigint;

create table if not exists public.auction_bids (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  bidder_id uuid references public.profiles (id) on delete set null,
  bidder_display_name text not null
    check (char_length(btrim(bidder_display_name)) between 1 and 80),
  amount bigint not null check (amount > 0),
  is_final boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, product_id)
);

create index if not exists auction_bids_product_time_idx
  on public.auction_bids (product_id, created_at, id);

create index if not exists auction_bids_product_bidder_idx
  on public.auction_bids (product_id, bidder_id);

alter table public.products
  add column if not exists final_bid_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_final_bid_matches_product_fkey'
  ) then
    alter table public.products
      add constraint products_final_bid_matches_product_fkey
      foreign key (final_bid_id, id)
      references public.auction_bids (id, product_id)
      on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_final_bid_state_check'
  ) then
    alter table public.products
      add constraint products_final_bid_state_check
      check (
        (
          bid_locked_at is null
          and final_bid_id is null
          and final_bid_amount is null
        )
        or
        (
          bid_locked_at is not null
          and final_bid_id is not null
          and final_bid_amount is not null
          and final_bid_amount > 0
        )
      );
  end if;
end;
$$;

alter table public.auction_bids enable row level security;
revoke all on public.auction_bids from anon, authenticated;
grant select on public.auction_bids to authenticated;

drop policy if exists "Members read their bids" on public.auction_bids;
create policy "Members read their bids"
on public.auction_bids
for select
to authenticated
using (bidder_id = (select auth.uid()));

drop policy if exists "Staff read every bid" on public.auction_bids;
create policy "Staff read every bid"
on public.auction_bids
for select
to authenticated
using ((select public.is_staff()));

create or replace function public.place_bid(
  p_product_id uuid,
  p_amount bigint
)
returns table (
  bid_id uuid,
  product_id uuid,
  bidder_id uuid,
  bidder_display_name text,
  amount bigint,
  created_at timestamptz,
  is_final boolean,
  current_price bigint,
  participant_count integer,
  bid_locked_at timestamptz,
  final_bid_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_kst_time time := (v_now at time zone 'Asia/Seoul')::time;
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_product public.products%rowtype;
  v_bid_id uuid := gen_random_uuid();
  v_has_any_bid boolean;
  v_user_has_bid boolean;
  v_is_final boolean := false;
  v_minimum_amount bigint;
  v_participant_count integer;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = '로그인 후 입찰할 수 있습니다.';
  end if;

  if public.is_staff() then
    raise exception using
      errcode = '42501',
      message = '관리자와 운영자 계정은 입찰에 참여할 수 없습니다.';
  end if;

  select profiles.display_name
  into v_display_name
  from public.profiles as profiles
  where profiles.id = v_user_id;

  if v_display_name is null then
    raise exception using
      errcode = '23503',
      message = '회원 프로필을 찾을 수 없습니다. 다시 로그인해 주세요.';
  end if;

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '입찰 상품을 찾을 수 없습니다.';
  end if;

  if v_product.status <> 'active' or v_product.publish_at > v_now then
    raise exception using
      errcode = 'P0001',
      message = '현재 공개 중인 상품만 입찰할 수 있습니다.';
  end if;

  if v_product.bid_locked_at is not null then
    raise exception using
      errcode = 'P0001',
      message = '확정 입찰이 완료된 상품입니다.';
  end if;

  if v_now >= v_product.closes_at or v_kst_time >= time '21:00:00' then
    raise exception using
      errcode = 'P0001',
      message = '오늘 오후 9시 경매가 마감되었습니다.';
  end if;

  select exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = p_product_id
  )
  into v_has_any_bid;

  select exists (
    select 1
    from public.auction_bids as bids
    where bids.product_id = p_product_id
      and bids.bidder_id = v_user_id
  )
  into v_user_has_bid;

  if v_kst_time >= time '20:56:00' then
    if not v_has_any_bid then
      v_is_final := true;
    elsif not v_user_has_bid then
      raise exception using
        errcode = 'P0001',
        message = '오후 8시 56분부터는 기존 참여자만 입찰할 수 있습니다.';
    end if;
  end if;

  v_minimum_amount := case
    when v_has_any_bid then v_product.current_price + v_product.bid_increment
    else v_product.starting_price
  end;

  if p_amount is null or p_amount < v_minimum_amount then
    raise exception using
      errcode = '22003',
      message = format('현재 최소 입찰가는 %s원입니다.', v_minimum_amount);
  end if;

  insert into public.auction_bids (
    id,
    product_id,
    bidder_id,
    bidder_display_name,
    amount,
    is_final,
    created_at
  )
  values (
    v_bid_id,
    p_product_id,
    v_user_id,
    v_display_name,
    p_amount,
    v_is_final,
    v_now
  );

  v_participant_count := v_product.participant_count
    + case when v_user_has_bid then 0 else 1 end;

  update public.products
  set
    current_price = p_amount,
    participant_count = v_participant_count,
    bid_history = jsonb_build_array(
      jsonb_build_object(
        'id', v_bid_id::text,
        'bidAt', v_now,
        'bidderName', v_display_name,
        'amount', p_amount
      )
    ) || coalesce(v_product.bid_history, '[]'::jsonb),
    bid_locked_at = case when v_is_final then v_now else null end,
    final_bid_id = case when v_is_final then v_bid_id else null end,
    final_bid_amount = case when v_is_final then p_amount else null end
  where id = p_product_id;

  return query
  select
    v_bid_id,
    p_product_id,
    v_user_id,
    v_display_name,
    p_amount,
    v_now,
    v_is_final,
    p_amount,
    v_participant_count,
    case when v_is_final then v_now else null end,
    case when v_is_final then v_bid_id else null end;
end;
$$;

revoke all on function public.place_bid(uuid, bigint) from public;
grant execute on function public.place_bid(uuid, bigint) to authenticated;

do $$
begin
  alter publication supabase_realtime
    add table public.profiles;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime
    add table public.support_conversations;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime
    add table public.support_messages;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime
    add table public.support_reads;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'close-expired-products'
  ) then
    perform cron.schedule(
      'close-expired-products',
      '* * * * *',
      $job$
        update public.products
        set status = 'closed'
        where status in ('pending', 'active')
          and closes_at <= now();
      $job$
    );
  end if;
end;
$$;

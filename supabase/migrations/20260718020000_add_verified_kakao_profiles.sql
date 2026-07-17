-- Verified Kakao member attributes used for account identification, support,
-- shipping, and member operations. Provider access tokens are never stored.

create table if not exists public.kakao_member_profiles (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  kakao_subject text not null unique
    check (char_length(kakao_subject) between 1 and 128),
  full_name text check (
    full_name is null or char_length(btrim(full_name)) between 1 and 80
  ),
  gender text check (gender is null or gender in ('female', 'male')),
  birth_year smallint check (
    birth_year is null or birth_year between 1900 and 2200
  ),
  profile_complete boolean not null default false,
  consent_items text[] not null default '{}',
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_kakao_member_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_kakao_member_profiles_updated_at() from public;

drop trigger if exists kakao_member_profiles_set_updated_at
on public.kakao_member_profiles;
create trigger kakao_member_profiles_set_updated_at
before update on public.kakao_member_profiles
for each row execute function public.set_kakao_member_profiles_updated_at();

alter table public.kakao_member_profiles enable row level security;
revoke all on public.kakao_member_profiles from anon, authenticated;
grant select on public.kakao_member_profiles to authenticated;

drop policy if exists "Members read their verified Kakao profile"
on public.kakao_member_profiles;
create policy "Members read their verified Kakao profile"
on public.kakao_member_profiles
for select
to authenticated
using (
  member_id = (select auth.uid())
  and (select public.is_member())
);

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
    ),
    profiles.created_at,
    users.last_sign_in_at
  from public.profiles as profiles
  join auth.users as users on users.id = profiles.id
  join public.member_accounts as accounts on accounts.member_id = profiles.id
  left join public.kakao_member_profiles as kakao_profiles
    on kakao_profiles.member_id = profiles.id
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
grant execute on function public.get_staff_member_directory(integer, integer)
to authenticated;

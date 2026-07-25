\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create schema app_private;
create role anon;
create role authenticated;
create role service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table app_private.ledger_principals (
  id uuid primary key
);

create table public.profiles (
  id uuid primary key references app_private.ledger_principals(id),
  display_name text not null,
  nickname_initialized_at timestamptz,
  deleted_at timestamptz
);

create table public.account_access_roles (
  user_id uuid primary key references public.profiles(id),
  role_code text not null
);

create table public.member_accounts (
  member_id uuid primary key references public.profiles(id),
  account_status text not null
);

create table public.nickname_change_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id),
  requested_nickname text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id),
  review_note text check (
    review_note is null or char_length(btrim(review_note)) <= 300
  ),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz
);

create table app_private.member_management_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references app_private.ledger_principals(id),
  member_id uuid not null references app_private.ledger_principals(id),
  action text not null,
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);

create or replace function public.assert_valid_member_nickname(p_nickname text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nickname text := btrim(
    regexp_replace(coalesce(p_nickname, ''), '[[:space:]]+', ' ', 'g')
  );
begin
  if char_length(v_nickname) not between 2 and 20 then
    raise exception using errcode = '22023', message = 'invalid nickname';
  end if;
  return v_nickname;
end;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_access_roles as roles
    where roles.user_id = auth.uid()
      and roles.role_code = 'owner'
  );
$$;

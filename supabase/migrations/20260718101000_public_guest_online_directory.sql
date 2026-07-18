-- The public feed intentionally shows ephemeral online nicknames to visitors.
-- Guest identities themselves stay in Supabase Realtime Presence and never
-- enter a database table; this RPC only exposes already-public Kakao nicknames
-- for accounts that sent a recent heartbeat. Owner, employee, uninitialized,
-- and synthetic test accounts remain excluded.

create or replace function public.get_online_member_directory(
  p_limit integer default 50
)
returns table (
  id uuid,
  display_name text,
  is_operator boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using
      errcode = '22023',
      message = '온라인 회원 조회 범위를 확인해 주세요.';
  end if;

  return query
  with online as (
    select
      profiles.id,
      profiles.display_name,
      roles.role_code = 'operator' as is_operator
    from public.account_last_seen as last_seen
    join public.account_access_roles as roles
      on roles.user_id = last_seen.user_id
    join public.profiles as profiles
      on profiles.id = last_seen.user_id
    where last_seen.last_seen_at >= statement_timestamp() - interval '75 seconds'
      and roles.role_code in ('operator', 'band_member', 'member')
      and profiles.nickname_initialized_at is not null
      and public.auth_user_has_kakao_identity(last_seen.user_id)
      and not public.is_owner_hidden_test_member(last_seen.user_id)
  )
  select
    online.id,
    online.display_name,
    online.is_operator,
    count(*) over () as total_count
  from online
  order by online.is_operator desc, online.display_name, online.id
  limit p_limit;
end;
$$;

revoke all on function public.get_online_member_directory(integer) from public;
grant execute on function public.get_online_member_directory(integer)
to anon, authenticated;

comment on function public.get_online_member_directory(integer) is
  'Public recent-presence directory. Excludes owner, employee, synthetic, non-Kakao, and uninitialized accounts.';

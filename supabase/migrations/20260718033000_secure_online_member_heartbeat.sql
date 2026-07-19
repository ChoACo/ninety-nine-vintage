-- Replace client-asserted Realtime Presence metadata with a server-verified
-- directory. Only an authenticated Kakao account can read it, and names/roles
-- always come from protected database records rather than browser payloads.
create or replace function public.get_online_member_directory(
  p_limit integer default 51
)
returns table (
  id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 로그인이 필요합니다.';
  end if;

  if p_limit is null or p_limit not between 1 and 51 then
    raise exception using errcode = '22023', message = '온라인 회원 조회 범위를 확인해 주세요.';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name
  from public.account_last_seen as last_seen
  join public.account_access_roles as roles on roles.user_id = last_seen.user_id
  join public.profiles as profiles on profiles.id = last_seen.user_id
  where last_seen.last_seen_at >= statement_timestamp() - interval '75 seconds'
    and roles.role_code in ('operator', 'band_member', 'member')
    and public.auth_user_has_kakao_identity(last_seen.user_id)
  order by profiles.display_name, profiles.id
  limit p_limit;
end;
$$;

revoke all on function public.get_online_member_directory(integer) from public;
grant execute on function public.get_online_member_directory(integer) to authenticated;

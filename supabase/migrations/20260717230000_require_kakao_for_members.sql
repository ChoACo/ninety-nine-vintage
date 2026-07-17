-- A public member session must originate from Kakao. Explicit member metadata
-- is not sufficient on its own; admin and operator password sessions remain
-- separate staff identities.
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
    ),
    false
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

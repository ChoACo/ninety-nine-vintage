-- Stage the reviewed Kakao consent rollout without breaking login before Kakao
-- approves the three private scopes. Flip the singleton to true only after the
-- Developers consent items are saved as required.
create table if not exists public.kakao_profile_requirements (
  singleton boolean primary key default true check (singleton),
  enforce_verified_profile boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.kakao_profile_requirements (
  singleton,
  enforce_verified_profile
)
values (true, false)
on conflict (singleton) do nothing;

alter table public.kakao_profile_requirements enable row level security;
revoke all on public.kakao_profile_requirements from anon, authenticated;

create or replace function public.has_required_kakao_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    not (
      select requirements.enforce_verified_profile
      from public.kakao_profile_requirements as requirements
      where requirements.singleton
    )
    or exists (
      select 1
      from public.kakao_member_profiles as kakao_profiles
      where kakao_profiles.member_id = auth.uid()
        and kakao_profiles.profile_complete
    ),
    false
  );
$$;

revoke all on function public.has_required_kakao_profile() from public;
grant execute on function public.has_required_kakao_profile() to authenticated;

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
      and public.has_required_kakao_profile()
    ),
    false
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- Product intake can intentionally leave the descriptive classification fields
-- blank, and the immutable owner account can temporarily use the member
-- surface without changing its stored access role.

alter table public.products
  add column if not exists gender text not null default '';

alter table public.products
  drop constraint if exists products_gender_check,
  add constraint products_gender_check
    check (gender in ('', '남성', '여성', '공용')),
  drop constraint if exists products_title_length_check,
  add constraint products_title_length_check
    check (char_length(btrim(title)) between 0 and 160),
  drop constraint if exists products_brand_nonempty,
  add constraint products_brand_nonempty
    check (char_length(btrim(brand)) between 0 and 80),
  drop constraint if exists products_brand_slug_nonempty,
  add constraint products_brand_slug_nonempty
    check (char_length(btrim(brand_slug)) between 0 and 80),
  drop constraint if exists products_condition_grade_check,
  add constraint products_condition_grade_check
    check (condition_grade in ('', 'S', 'A+', 'A', 'B'));

comment on column public.products.gender is
  'Operator-entered catalog gender; an empty string means not entered.';

create table if not exists public.owner_member_mode_sessions (
  owner_id uuid primary key references public.profiles(id) on delete restrict,
  activated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint owner_member_mode_fixed_owner_check
    check (owner_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid),
  constraint owner_member_mode_expiry_check
    check (expires_at > activated_at)
);

alter table public.owner_member_mode_sessions enable row level security;
alter table public.owner_member_mode_sessions force row level security;
revoke all on public.owner_member_mode_sessions from public, anon, authenticated;
grant select, insert, update on public.owner_member_mode_sessions to service_role;

comment on table public.owner_member_mode_sessions is
  'Server-controlled three-minute member-mode lease for the immutable owner account.';

insert into public.member_accounts(member_id)
select profiles.id
from public.profiles as profiles
where profiles.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
on conflict (member_id) do nothing;

create or replace function public.owner_member_mode_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_user_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
    and exists (
      select 1
      from public.owner_member_mode_sessions as sessions
      where sessions.owner_id = p_user_id
        and sessions.ended_at is null
        and sessions.expires_at > statement_timestamp()
    ),
    false
  );
$$;

revoke all on function public.owner_member_mode_is_active(uuid)
from public, anon, authenticated;
grant execute on function public.owner_member_mode_is_active(uuid)
to service_role;

create or replace function public.access_role_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profiles.deleted_at is not null then null
    when public.owner_member_mode_is_active(p_user_id) then 'member'
    when roles.role_code = 'owner' and exists (
      select 1
      from auth.users as users
      where users.id = roles.user_id
    ) then 'owner'
    when roles.role_code <> 'owner'
      and public.auth_user_has_kakao_identity(roles.user_id)
    then roles.role_code
    else null
  end
  from public.account_access_roles as roles
  join public.profiles as profiles on profiles.id = roles.user_id
  where roles.user_id = p_user_id;
$$;

revoke all on function public.access_role_for_user(uuid) from public, anon;
grant execute on function public.access_role_for_user(uuid)
to authenticated, service_role;

create or replace function public.current_access_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.access_role_for_user(auth.uid());
$$;

revoke all on function public.current_access_role() from public, anon;
grant execute on function public.current_access_role() to authenticated;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_access_role() in ('band_member', 'member')
    and exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = auth.uid()
        and public.effective_member_account_status(accounts.member_id) = 'active'
    )
    and public.has_required_kakao_profile(),
    false
  );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

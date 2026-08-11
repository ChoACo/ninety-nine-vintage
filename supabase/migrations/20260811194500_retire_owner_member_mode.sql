-- Replace Owner-as-member impersonation with a dedicated Auth member account.
-- Preserve the historical lease rows as read-only audit evidence.

update public.owner_member_mode_sessions
set ended_at = coalesce(ended_at, clock_timestamp()),
    updated_at = clock_timestamp()
where ended_at is null;

create or replace function public.owner_member_mode_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

revoke all on function public.owner_member_mode_is_active(uuid)
from public, anon, authenticated;
grant execute on function public.owner_member_mode_is_active(uuid)
to service_role;

revoke insert, update, delete on public.owner_member_mode_sessions
from service_role;

comment on table public.owner_member_mode_sessions is
  'Retired Owner-as-member lease history. No new sessions may be written.';
comment on function public.owner_member_mode_is_active(uuid) is
  'Retired compatibility function that always returns false.';

-- The isolated production test member is a real Auth user with the ordinary
-- member role, but intentionally has no third-party Kakao identity. Keep the
-- Kakao requirement for every normal account and exempt only the active,
-- server-provisioned hidden test principal.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      public.current_access_role() in ('band_member', 'member')
      or exists (
        select 1
        from public.commerce_buyer_accounts buyers
        where buyers.user_id = auth.uid()
          and buyers.status = 'active'
      )
      or public.current_access_role() in ('owner', 'operator', 'employee')
    )
    and (
      exists (
        select 1
        from public.member_accounts accounts
        where accounts.member_id = auth.uid()
          and public.effective_member_account_status(accounts.member_id) = 'active'
      )
      or public.current_access_role() in ('owner', 'operator', 'employee')
    )
    and (
      public.has_required_kakao_profile()
      or (
        public.current_access_role() = 'member'
        and public.is_owner_hidden_test_member(auth.uid())
      )
    ),
    false
  );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

comment on function public.is_member() is
  'Commerce-member check with a narrow exception for the active isolated production test member.';

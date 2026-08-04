begin;

-- Operators, staff, and owners should be treated as members for commerce
-- operations (bidding, purchasing, cart) even without a member_accounts row.
alter function public.is_member()
  security definer
  set search_path = '';

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
    and public.has_required_kakao_profile(),
    false
  );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

commit;
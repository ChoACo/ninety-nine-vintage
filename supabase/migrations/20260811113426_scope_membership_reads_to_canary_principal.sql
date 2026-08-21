-- Allow the immutable Owner account to exercise exactly the selected
-- operator/employee membership during a short-lived role canary. Outside an
-- active canary current_authorization_principal() is the authenticated user,
-- so the existing membership boundary is unchanged.

-- This migration sorts before the full canary implementation. Bootstrap the
-- fail-closed default so a clean database can apply the policy; the later
-- owner-role-canary migration replaces this body with its bounded override.
create or replace function public.current_authorization_principal()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

revoke all on function public.current_authorization_principal()
from public, anon, authenticated, service_role;
grant execute on function public.current_authorization_principal()
to authenticated;

drop policy if exists "Owners and members read store memberships"
on public.store_memberships;

create policy "Owners and members read store memberships"
on public.store_memberships
for select
to authenticated
using (
  (select public.is_owner())
  or user_id = (select public.current_authorization_principal())
);

comment on policy "Owners and members read store memberships"
on public.store_memberships is
  'Owners read all memberships; other sessions read only their effective authorization principal, including an active Owner role canary.';

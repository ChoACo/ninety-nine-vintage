-- Allow the immutable Owner account to exercise exactly the selected
-- operator/employee membership during a short-lived role canary. Outside an
-- active canary current_authorization_principal() is the authenticated user,
-- so the existing membership boundary is unchanged.

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

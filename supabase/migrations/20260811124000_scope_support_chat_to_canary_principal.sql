-- Preserve member-mode ownership while allowing the immutable Owner's
-- operator/employee canary to exercise the target staff member's exact chat
-- assignment. The helper returns auth.uid() for every ordinary session.

create or replace function public.can_access_support_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with actor as (select auth.uid() as session_id, public.current_authorization_principal() as principal_id)
  select exists (
    select 1 from public.support_conversations conversations cross join actor
    where conversations.id = p_conversation_id
      and (public.is_owner() or not public.is_owner_hidden_test_member(conversations.member_id))
      and (
        public.is_owner()
        or (public.support_access_role(actor.principal_id) = 'operator'
          and conversations.assigned_staff_id = actor.principal_id
          and ((conversations.conversation_type in ('general', 'product')
              and public.support_store_operator(conversations.store_id) = actor.principal_id)
            or (conversations.conversation_type = 'internal' and conversations.store_id is null
              and public.support_employee_operator(conversations.member_id) = actor.principal_id)))
        or (public.support_access_role(actor.principal_id) = 'employee'
          and public.has_kakao_identity(actor.principal_id)
          and ((conversations.conversation_type in ('general', 'product')
              and conversations.assigned_staff_id = public.support_employee_operator(actor.principal_id)
              and public.support_store_operator(conversations.store_id) = conversations.assigned_staff_id
              and exists (select 1 from public.store_memberships memberships
                where memberships.store_id = conversations.store_id
                  and memberships.user_id = actor.principal_id
                  and memberships.membership_role = 'employee' and memberships.status = 'active'))
            or (conversations.member_id = actor.principal_id and conversations.conversation_type = 'internal'
              and conversations.assigned_staff_id = public.support_employee_operator(actor.principal_id))))
        or (public.is_support_member(actor.session_id) and conversations.member_id = actor.session_id
          and conversations.conversation_type in ('general', 'product'))
      )
  );
$$;

create or replace function public.can_manage_support_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with actor as (select public.current_authorization_principal() as principal_id)
  select exists (
    select 1 from public.support_conversations conversations cross join actor
    where conversations.id = p_conversation_id
      and conversations.assigned_staff_id = actor.principal_id
      and public.support_access_role(actor.principal_id) = 'operator'
      and public.support_store_operator(conversations.store_id) = actor.principal_id
      and not public.is_owner_hidden_test_member(conversations.member_id)
  );
$$;

create or replace function public.can_send_support_message(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with actor as (select auth.uid() as session_id, public.current_authorization_principal() as principal_id)
  select exists (
    select 1 from public.support_conversations conversations cross join actor
    where conversations.id = p_conversation_id and conversations.status = 'open'
      and (public.is_owner() or not public.is_owner_hidden_test_member(conversations.member_id))
      and (
        (public.support_access_role(actor.principal_id) = 'operator'
          and conversations.assigned_staff_id = actor.principal_id
          and ((conversations.conversation_type in ('general', 'product')
              and public.support_store_operator(conversations.store_id) = actor.principal_id)
            or (conversations.conversation_type = 'internal' and conversations.store_id is null
              and public.support_employee_operator(conversations.member_id) = actor.principal_id)))
        or (public.support_access_role(actor.principal_id) = 'employee'
          and public.has_kakao_identity(actor.principal_id)
          and ((conversations.conversation_type in ('general', 'product')
              and conversations.assigned_staff_id = public.support_employee_operator(actor.principal_id)
              and public.support_store_operator(conversations.store_id) = conversations.assigned_staff_id
              and exists (select 1 from public.store_memberships memberships
                where memberships.store_id = conversations.store_id
                  and memberships.user_id = actor.principal_id
                  and memberships.membership_role = 'employee' and memberships.status = 'active'))
            or (conversations.member_id = actor.principal_id and conversations.conversation_type = 'internal'
              and conversations.assigned_staff_id = public.support_employee_operator(actor.principal_id))))
        or (public.is_support_member(actor.session_id) and conversations.member_id = actor.session_id
          and conversations.conversation_type in ('general', 'product'))
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid) from public;
revoke all on function public.can_manage_support_conversation(uuid) from public;
revoke all on function public.can_send_support_message(uuid) from public;
grant execute on function public.can_access_support_conversation(uuid) to authenticated;
grant execute on function public.can_manage_support_conversation(uuid) to authenticated;
grant execute on function public.can_send_support_message(uuid) to authenticated;

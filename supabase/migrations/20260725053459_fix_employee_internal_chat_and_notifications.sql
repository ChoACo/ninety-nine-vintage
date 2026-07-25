begin;

alter table public.notifications
  drop constraint if exists notifications_audience_role_check;
alter table public.notifications
  add constraint notifications_audience_role_check
  check (audience_role in ('member', 'operator', 'employee', 'owner'));

drop policy if exists "Members read their notifications"
  on public.notifications;
create policy "Users read their notifications"
on public.notifications
for select
to authenticated
using (member_id = (select auth.uid()));

create or replace function app_private.insert_targeted_notification(
  p_user_id uuid,
  p_audience_role text,
  p_kind text,
  p_title text,
  p_body text,
  p_href text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.notifications (
    member_id,
    audience_role,
    kind,
    title,
    body,
    href
  )
  values (
    p_user_id,
    case
      when p_audience_role in ('operator', 'employee', 'owner')
        then p_audience_role
      else 'member'
    end,
    left(p_kind, 80),
    left(p_title, 160),
    left(p_body, 1000),
    case when coalesce(p_href, '') ~ '^/' then left(p_href, 2048) else null end
  );
end;
$$;

revoke all on function app_private.insert_targeted_notification(
  uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function app_private.insert_staff_notifications(
  p_business_id uuid,
  p_operator_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_href text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    member_id,
    audience_role,
    kind,
    title,
    body,
    href
  )
  select distinct
    roles.user_id,
    case when roles.role_code = 'employee' then 'employee' else 'operator' end,
    left(p_kind, 80),
    left(p_title, 160),
    left(p_body, 1000),
    case
      when roles.role_code = 'employee'
        and coalesce(p_href, '') ~ '^/admin/operator/chat'
        then left(
          regexp_replace(
            p_href,
            '^/admin/operator/chat',
            '/admin/employee/inquiries'
          ),
          2048
        )
      when coalesce(p_href, '') ~ '^/' then left(p_href, 2048)
      else null
    end
  from public.account_access_roles as roles
  where roles.role_code in ('operator', 'employee')
    and (
      (
        p_operator_id is not null
        and (
          roles.user_id = p_operator_id
          or (
            roles.role_code = 'employee'
            and roles.reports_to_operator_id = p_operator_id
          )
        )
      )
      or (
        p_business_id is not null
        and exists (
          select 1
          from public.store_memberships as memberships
          where memberships.business_id = p_business_id
            and memberships.user_id = roles.user_id
            and memberships.status = 'active'
        )
      )
      or (
        p_business_id is null
        and p_operator_id is null
      )
    );
end;
$$;

revoke all on function app_private.insert_staff_notifications(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.can_access_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and (
        public.is_owner()
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and (
        public.is_owner()
        or (
          public.support_access_role(auth.uid()) = 'operator'
          and conversations.assigned_staff_id = auth.uid()
          and (
            (
              conversations.conversation_type in ('general', 'product')
              and public.support_store_operator(conversations.store_id) = auth.uid()
            )
            or (
              conversations.conversation_type = 'internal'
              and conversations.store_id is null
              and public.support_employee_operator(conversations.member_id) = auth.uid()
            )
          )
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and (
            (
              conversations.conversation_type in ('general', 'product')
              and conversations.assigned_staff_id =
                public.support_employee_operator(auth.uid())
              and public.support_store_operator(conversations.store_id) =
                conversations.assigned_staff_id
              and exists (
                select 1
                from public.store_memberships as memberships
                where memberships.store_id = conversations.store_id
                  and memberships.user_id = auth.uid()
                  and memberships.membership_role = 'employee'
                  and memberships.status = 'active'
              )
            )
            or (
              conversations.member_id = auth.uid()
              and conversations.conversation_type = 'internal'
              and conversations.assigned_staff_id =
                public.support_employee_operator(auth.uid())
            )
          )
        )
        or (
          public.is_support_member(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
        )
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid)
  from public;
grant execute on function public.can_access_support_conversation(uuid)
  to authenticated;

create or replace function public.can_send_support_message(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and conversations.status = 'open'
      and (
        public.is_owner()
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and (
        (
          public.support_access_role(auth.uid()) = 'operator'
          and conversations.assigned_staff_id = auth.uid()
          and (
            (
              conversations.conversation_type in ('general', 'product')
              and public.support_store_operator(conversations.store_id) = auth.uid()
            )
            or (
              conversations.conversation_type = 'internal'
              and conversations.store_id is null
              and public.support_employee_operator(conversations.member_id) = auth.uid()
            )
          )
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and (
            (
              conversations.conversation_type in ('general', 'product')
              and conversations.assigned_staff_id =
                public.support_employee_operator(auth.uid())
              and public.support_store_operator(conversations.store_id) =
                conversations.assigned_staff_id
              and exists (
                select 1
                from public.store_memberships as memberships
                where memberships.store_id = conversations.store_id
                  and memberships.user_id = auth.uid()
                  and memberships.membership_role = 'employee'
                  and memberships.status = 'active'
              )
            )
            or (
              conversations.member_id = auth.uid()
              and conversations.conversation_type = 'internal'
              and conversations.assigned_staff_id =
                public.support_employee_operator(auth.uid())
            )
          )
        )
        or (
          public.is_support_member(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
        )
      )
  );
$$;

revoke all on function public.can_send_support_message(uuid)
  from public;
grant execute on function public.can_send_support_message(uuid)
  to authenticated;

create or replace function app_private.notify_support_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.support_conversations%rowtype;
  v_business_id uuid;
  v_preview text;
begin
  select *
  into v_conversation
  from public.support_conversations
  where id = new.conversation_id;

  if not found or new.sender_id is null then
    return new;
  end if;

  v_preview := left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 160);

  if v_conversation.conversation_type = 'internal' then
    if new.sender_id = v_conversation.member_id then
      perform app_private.insert_targeted_notification(
        v_conversation.assigned_staff_id,
        'operator',
        'chat_message',
        '새로운 직원 채팅이 있습니다',
        v_preview,
        '/admin/operator/chat?conversationId=' || new.conversation_id::text
      );
    else
      perform app_private.insert_targeted_notification(
        v_conversation.member_id,
        'employee',
        'chat_message',
        '새로운 운영 채팅이 있습니다',
        v_preview,
        '/admin/employee/inquiries?conversationId=' || new.conversation_id::text
      );
    end if;
    return new;
  end if;

  if new.sender_id = v_conversation.member_id then
    select stores.business_id
    into v_business_id
    from public.stores
    where stores.id = v_conversation.store_id;

    perform app_private.insert_staff_notifications(
      v_business_id,
      v_conversation.assigned_staff_id,
      'chat_message',
      '새로운 채팅이 있습니다',
      v_preview,
      '/admin/operator/chat?conversationId=' || new.conversation_id::text
    );
  else
    perform app_private.insert_targeted_notification(
      v_conversation.member_id,
      'member',
      'chat_message',
      '새로운 채팅이 있습니다',
      v_preview,
      '/m/chat?conversationId=' || new.conversation_id::text
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.notify_support_message()
  from public, anon, authenticated, service_role;

commit;

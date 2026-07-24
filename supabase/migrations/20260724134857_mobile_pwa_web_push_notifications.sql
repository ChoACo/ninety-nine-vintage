begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

create extension if not exists pg_net with schema extensions;

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text not null default '',
  failure_count integer not null default 0 check (failure_count between 0 and 1000),
  last_success_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint web_push_subscriptions_endpoint_check check (
    endpoint ~ '^https://'
    and octet_length(endpoint) between 16 and 4096
  ),
  constraint web_push_subscriptions_keys_check check (
    octet_length(p256dh) between 32 and 1024
    and octet_length(auth_secret) between 8 and 512
  ),
  constraint web_push_subscriptions_user_agent_check check (
    octet_length(user_agent) <= 1024
  ),
  constraint web_push_subscriptions_time_check check (
    updated_at >= created_at
  )
);

create index web_push_subscriptions_active_user_idx
  on public.web_push_subscriptions (user_id, updated_at desc)
  where disabled_at is null;

create table public.web_push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique
    references public.notifications(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null,
  title text not null,
  body text not null,
  url text not null default '/m/home',
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  created_at timestamptz not null default clock_timestamp(),
  constraint web_push_notification_outbox_topic_check check (
    char_length(btrim(topic)) between 1 and 80
  ),
  constraint web_push_notification_outbox_title_check check (
    char_length(btrim(title)) between 1 and 160
  ),
  constraint web_push_notification_outbox_body_check check (
    char_length(btrim(body)) between 1 and 1000
  ),
  constraint web_push_notification_outbox_url_check check (
    url ~ '^/'
    and octet_length(url) <= 2048
  ),
  constraint web_push_notification_outbox_error_check check (
    last_error is null or octet_length(last_error) <= 2000
  ),
  constraint web_push_notification_outbox_time_check check (
    expires_at > created_at
  )
);

create index web_push_notification_outbox_pending_idx
  on public.web_push_notification_outbox (next_attempt_at, created_at, id)
  where delivered_at is null;

create index web_push_notification_outbox_recipient_idx
  on public.web_push_notification_outbox (recipient_user_id, created_at desc);

alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_subscriptions force row level security;
alter table public.web_push_notification_outbox enable row level security;
alter table public.web_push_notification_outbox force row level security;

revoke all on table public.web_push_subscriptions
  from public, anon, authenticated;
revoke all on table public.web_push_notification_outbox
  from public, anon, authenticated;
grant select, insert, update, delete on table public.web_push_subscriptions
  to service_role;
grant select, insert, update, delete on table public.web_push_notification_outbox
  to service_role;

create or replace function app_private.set_web_push_subscription_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.set_web_push_subscription_updated_at()
  from public, anon, authenticated, service_role;

create trigger web_push_subscriptions_set_updated_at
before update on public.web_push_subscriptions
for each row execute function app_private.set_web_push_subscription_updated_at();

create or replace function app_private.enqueue_web_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_id is not null then
    insert into public.web_push_notification_outbox (
      notification_id,
      recipient_user_id,
      topic,
      title,
      body,
      url
    )
    values (
      new.id,
      new.member_id,
      left(new.kind, 80),
      left(new.title, 160),
      left(new.body, 1000),
      case
        when coalesce(new.href, '') ~ '^/' then left(new.href, 2048)
        else '/m/home'
      end
    )
    on conflict (notification_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function app_private.enqueue_web_push_notification()
  from public, anon, authenticated, service_role;

create trigger notifications_enqueue_web_push
after insert on public.notifications
for each row execute function app_private.enqueue_web_push_notification();

create or replace function public.claim_web_push_notifications(
  p_limit integer default 25
)
returns table (
  id uuid,
  recipient_user_id uuid,
  topic text,
  title text,
  body text,
  url text,
  attempts integer,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with claimable as (
    select outbox.id
    from public.web_push_notification_outbox as outbox
    where outbox.delivered_at is null
      and outbox.expires_at > clock_timestamp()
      and outbox.next_attempt_at <= clock_timestamp()
      and (
        outbox.locked_at is null
        or outbox.locked_at < clock_timestamp() - interval '5 minutes'
      )
    order by outbox.created_at, outbox.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ),
  claimed as (
    update public.web_push_notification_outbox as outbox
    set
      locked_at = clock_timestamp(),
      attempts = outbox.attempts + 1
    from claimable
    where outbox.id = claimable.id
    returning
      outbox.id,
      outbox.recipient_user_id,
      outbox.topic,
      outbox.title,
      outbox.body,
      outbox.url,
      outbox.attempts,
      outbox.expires_at
  )
  select * from claimed;
$$;

revoke all on function public.claim_web_push_notifications(integer)
  from public, anon, authenticated;
grant execute on function public.claim_web_push_notifications(integer)
  to service_role;

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
    case when p_audience_role = 'operator' then 'operator' else 'member' end,
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
    'operator',
    left(p_kind, 80),
    left(p_title, 160),
    left(p_body, 1000),
    case when coalesce(p_href, '') ~ '^/' then left(p_href, 2048) else null end
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

create trigger support_messages_notify_web_push
after insert on public.support_messages
for each row execute function app_private.notify_support_message();

create or replace function app_private.notify_auction_winner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner_id uuid;
begin
  if new.status = 'closed'
    and new.final_bid_id is not null
    and (
      old.final_bid_id is distinct from new.final_bid_id
      or old.status is distinct from new.status
    )
  then
    select bids.bidder_id
    into v_winner_id
    from public.auction_bids as bids
    where bids.id = new.final_bid_id
      and bids.product_id = new.id;

    perform app_private.insert_targeted_notification(
      v_winner_id,
      'member',
      'auction_won',
      '낙찰되었습니다',
      left(new.title, 120) || ' 상품을 낙찰받았습니다. 결제 마감 전 확인해 주세요.',
      '/m/account?tab=bids'
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.notify_auction_winner()
  from public, anon, authenticated, service_role;

create trigger products_notify_auction_winner
after update of status, final_bid_id on public.products
for each row execute function app_private.notify_auction_winner();

create or replace function app_private.notify_inventory_shipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.insert_staff_notifications(
      new.business_id,
      null,
      'shipping_requested',
      '새 배송 요청이 있습니다',
      '회원의 배송 요청이 접수되었습니다.',
      '/admin/operator/shipping'
    );
  elsif new.status = 'shipped'
    and (
      old.status is distinct from new.status
      or old.tracking_number is distinct from new.tracking_number
      or old.courier is distinct from new.courier
    )
  then
    perform app_private.insert_targeted_notification(
      new.member_id,
      'member',
      'shipment_tracking_registered',
      '송장이 등록되었습니다',
      coalesce(nullif(btrim(new.courier), ''), '택배사') || ' '
        || coalesce(nullif(btrim(new.tracking_number), ''), '송장번호 확인 필요'),
      '/m/account?tab=shipments'
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.notify_inventory_shipment()
  from public, anon, authenticated, service_role;

create trigger inventory_shipments_notify_insert
after insert on public.inventory_shipments
for each row execute function app_private.notify_inventory_shipment();

create trigger inventory_shipments_notify_tracking
after update of status, courier, tracking_number on public.inventory_shipments
for each row execute function app_private.notify_inventory_shipment();

create or replace function app_private.notify_commerce_shipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.insert_staff_notifications(
      new.business_id,
      null,
      'shipping_requested',
      '새 배송 요청이 있습니다',
      '회원의 배송 요청이 접수되었습니다.',
      '/admin/operator/shipping'
    );
  elsif new.status = 'shipped'
    and (
      old.status is distinct from new.status
      or old.tracking_number is distinct from new.tracking_number
      or old.courier is distinct from new.courier
    )
  then
    perform app_private.insert_targeted_notification(
      new.member_id,
      'member',
      'shipment_tracking_registered',
      '송장이 등록되었습니다',
      coalesce(nullif(btrim(new.courier), ''), '택배사') || ' '
        || coalesce(nullif(btrim(new.tracking_number), ''), '송장번호 확인 필요'),
      '/m/account?tab=shipments'
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.notify_commerce_shipment()
  from public, anon, authenticated, service_role;

create trigger commerce_shipments_notify_insert
after insert on public.commerce_shipments
for each row execute function app_private.notify_commerce_shipment();

create trigger commerce_shipments_notify_tracking
after update of status, courier, tracking_number on public.commerce_shipments
for each row execute function app_private.notify_commerce_shipment();

create or replace function app_private.notify_manual_transfer_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select stores.business_id
  into v_business_id
  from public.products
  join public.stores on stores.id = products.store_id
  where products.id = new.product_id;

  perform app_private.insert_staff_notifications(
    v_business_id,
    null,
    'payment_verification_requested',
    '새 입금 확인 요청이 있습니다',
    new.order_name || ' · ' || to_char(new.expected_amount, 'FM999,999,999,990') || '원',
    '/admin/operator/payments'
  );

  return new;
end;
$$;

revoke all on function app_private.notify_manual_transfer_request()
  from public, anon, authenticated, service_role;

create trigger manual_transfer_orders_notify_insert
after insert on public.manual_transfer_orders
for each row execute function app_private.notify_manual_transfer_request();

create or replace function app_private.notify_commerce_transfer_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  for v_business_id in
    select distinct stores.business_id
    from public.commerce_order_items as items
    join public.stores on stores.id = items.store_id
    where items.order_id = new.order_id
  loop
    perform app_private.insert_staff_notifications(
      v_business_id,
      null,
      'payment_verification_requested',
      '새 입금 확인 요청이 있습니다',
      '즉시 구매 결제 · ' || to_char(new.expected_amount, 'FM999,999,999,990') || '원',
      '/admin/operator/payments'
    );
  end loop;

  return new;
end;
$$;

revoke all on function app_private.notify_commerce_transfer_request()
  from public, anon, authenticated, service_role;

create trigger commerce_order_transfers_notify_insert
after insert on public.commerce_order_transfers
for each row execute function app_private.notify_commerce_transfer_request();

create or replace function app_private.notify_shipping_payment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.insert_staff_notifications(
    new.business_id,
    null,
    'payment_verification_requested',
    '새 입금 확인 요청이 있습니다',
    case new.payment_context
      when 'shipping_credit' then '배송 크레딧 결제'
      when 'auction_bundle' then '낙찰품 택배비 결제'
      else '배송비 결제'
    end || ' · ' || to_char(new.expected_amount, 'FM999,999,999,990') || '원',
    '/admin/operator/payments'
  );

  return new;
end;
$$;

revoke all on function app_private.notify_shipping_payment_request()
  from public, anon, authenticated, service_role;

create trigger shipping_fee_payments_notify_insert
after insert on public.shipping_fee_payments
for each row execute function app_private.notify_shipping_payment_request();

create or replace function app_private.invoke_web_push_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_url text;
  v_dispatch_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_dispatch_url
  from vault.decrypted_secrets
  where name = 'web_push_dispatch_url'
  limit 1;

  select decrypted_secret
  into v_dispatch_secret
  from vault.decrypted_secrets
  where name = 'web_push_dispatch_secret'
  limit 1;

  if nullif(btrim(coalesce(v_dispatch_url, '')), '') is null
    or nullif(btrim(coalesce(v_dispatch_secret, '')), '') is null
  then
    return null;
  end if;

  delete from public.web_push_notification_outbox
  where delivered_at < clock_timestamp() - interval '30 days'
     or expires_at < clock_timestamp() - interval '30 days';

  delete from public.web_push_subscriptions
  where disabled_at < clock_timestamp() - interval '30 days';

  select net.http_post(
    url := v_dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_dispatch_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function app_private.invoke_web_push_dispatch()
  from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'dispatch-web-push-notifications'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'dispatch-web-push-notifications',
    '* * * * *',
    'select app_private.invoke_web_push_dispatch();'
  );
end;
$$;

comment on table public.web_push_subscriptions
  is 'Server-owned browser push subscriptions. An endpoint belongs to exactly one current user.';
comment on table public.web_push_notification_outbox
  is 'Retryable web-push delivery queue mirrored from targeted in-app notifications.';

commit;

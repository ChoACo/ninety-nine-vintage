begin;

create or replace function public.queue_test_web_push_notification()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_last_created_at timestamptz;
  v_notification_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));

  select notifications.created_at
  into v_last_created_at
  from public.notifications
  where notifications.member_id = v_actor
    and notifications.kind = 'web_push_test'
  order by notifications.created_at desc
  limit 1;

  if v_last_created_at is not null
    and v_last_created_at > clock_timestamp() - interval '30 seconds'
  then
    return jsonb_build_object(
      'queued', false,
      'retryAfterSeconds', greatest(
        1,
        ceil(extract(epoch from (
          v_last_created_at + interval '30 seconds' - clock_timestamp()
        )))::integer
      )
    );
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
    v_actor,
    'member',
    'web_push_test',
    'NINETY-NINE 시험 알림',
    '이 알림은 실제 사건과 같은 전송 경로로 전달되었습니다.',
    '/m/account/settings'
  )
  returning id into v_notification_id;

  return jsonb_build_object(
    'queued', true,
    'notificationId', v_notification_id
  );
end;
$$;

revoke all on function public.queue_test_web_push_notification()
  from public, anon, authenticated, service_role;
grant execute on function public.queue_test_web_push_notification()
  to authenticated;

create or replace function app_private.notify_store_sale_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_operator_id uuid;
begin
  select stores.business_id, stores.operator_id
  into v_business_id, v_operator_id
  from public.stores
  where stores.id = new.origin_store_id;

  if v_business_id is not null then
    perform app_private.insert_staff_notifications(
      v_business_id,
      v_operator_id,
      'sale_created',
      '새 판매가 발생했습니다',
      '판매 상품의 결제 완료와 출고 준비 상태를 확인해 주세요.',
      '/admin/operator/fulfillment'
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.notify_store_sale_created()
  from public, anon, authenticated, service_role;

create trigger customer_inventory_items_notify_store_sale
after insert on public.customer_inventory_items
for each row execute function app_private.notify_store_sale_created();

create or replace function app_private.enqueue_web_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_push_body text;
begin
  if new.member_id is not null then
    v_push_body := case new.kind
      when 'chat_message' then '새 메시지를 확인해 주세요.'
      when 'payment_verification_requested' then '새 입금 확인 업무를 확인해 주세요.'
      when 'shipment_tracking_registered' then '새 배송 상태를 확인해 주세요.'
      when 'shipping_requested' then '새 배송 요청 업무를 확인해 주세요.'
      else left(new.body, 1000)
    end;

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
      v_push_body,
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

commit;

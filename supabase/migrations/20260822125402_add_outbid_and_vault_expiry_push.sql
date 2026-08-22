begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

create or replace function app_private.notify_previous_high_bidder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.auction_bids%rowtype;
  v_title text;
begin
  select bids.*
  into v_previous
  from public.auction_bids as bids
  where bids.product_id = new.product_id
    and bids.id <> new.id
    and bids.bidder_id is not null
    and not exists (
      select 1
      from public.cancelled_auction_bids as cancelled
      where cancelled.original_bid_id = bids.id
    )
  order by bids.amount desc, bids.created_at desc, bids.id desc
  limit 1;

  if v_previous.id is null or v_previous.bidder_id = new.bidder_id then
    return new;
  end if;

  select products.title into v_title
  from public.products
  where products.id = new.product_id;

  perform app_private.insert_targeted_notification(
    v_previous.bidder_id,
    'member',
    'auction_outbid',
    '[99 Live Auction] 입찰 추월 알림!',
    coalesce(left(v_title, 120) || ' · ', '') ||
      '회원님의 최고 입찰가가 추월당했습니다. 지금 확인하고 다시 입찰하세요.',
    '/live/' || new.product_id::text
  );

  return new;
end;
$$;

revoke all on function app_private.notify_previous_high_bidder()
from public, anon, authenticated, service_role;

drop trigger if exists auction_bids_notify_previous_high_bidder
on public.auction_bids;
create trigger auction_bids_notify_previous_high_bidder
after insert on public.auction_bids
for each row execute function app_private.notify_previous_high_bidder();

create or replace function app_private.queue_vault_expiring_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidates as (
    select
      inventory.id,
      inventory.member_id,
      inventory.storage_started_at,
      inventory.storage_expires_at,
      products.title,
      '[99 보관함] 보관 만료 D-3 알림'::text as notice_title,
      left(products.title, 120) ||
        ' · 보관 중인 상품의 무료 기한이 3일 이내로 남았습니다. 묶음 배송을 신청하세요!' as notice_body
    from public.customer_inventory_items as inventory
    join public.inventory_item_fulfillments as fulfillment
      on fulfillment.inventory_item_id = inventory.id
    join public.products on products.id = inventory.product_id
    where inventory.ownership_status = 'active'
      and fulfillment.current_stage = 'center_stored'
      and inventory.storage_started_at is not null
      and inventory.storage_expires_at > clock_timestamp()
      and inventory.storage_expires_at <= clock_timestamp() + interval '3 days'
      and not exists (
        select 1
        from public.inventory_shipment_items as shipment_items
        where shipment_items.inventory_item_id = inventory.id
          and shipment_items.line_status in ('requested', 'held', 'ready', 'packed', 'shipped')
      )
  ), inserted as (
    insert into public.notifications (
      member_id, audience_role, kind, title, body, href
    )
    select
      candidates.member_id,
      'member',
      'vault_expiring_soon',
      candidates.notice_title,
      candidates.notice_body,
      '/my/vault'
    from candidates
    where not exists (
      select 1
      from public.notifications
      where notifications.member_id = candidates.member_id
        and notifications.kind = 'vault_expiring_soon'
        and notifications.body = candidates.notice_body
        and notifications.created_at >= candidates.storage_started_at
    )
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function app_private.queue_vault_expiring_notifications()
from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'queue-vault-expiring-push';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'queue-vault-expiring-push',
    '5 * * * *',
    'select app_private.queue_vault_expiring_notifications()'
  );
end;
$$;

create or replace function app_private.insert_owner_payment_notification(
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.insert_targeted_notification(
    roles.user_id,
    'owner',
    'payment_verification_requested',
    '[관리자 알림] 무통장 입금 확인 요청',
    left(p_body, 1000),
    '/admin/owner/settlements?tab=deposits'
  )
  from public.account_access_roles as roles
  where roles.role_code = 'owner';
end;
$$;

revoke all on function app_private.insert_owner_payment_notification(text)
from public, anon, authenticated, service_role;

create or replace function app_private.notify_combined_auction_payment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_count integer;
begin
  if new.last_depositor_name is null then return new; end if;
  select count(*)::integer into v_item_count
  from public.manual_transfer_orders
  where buyer_id = new.member_id
    and status = 'awaiting_manual_transfer';
  perform app_private.insert_owner_payment_notification(
    '낙찰품 ' || v_item_count::text || '개의 일괄 입금 확인 요청이 접수되었습니다.'
  );
  return new;
end;
$$;

create or replace function app_private.notify_commerce_transfer_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.insert_owner_payment_notification(
    '즉시 구매 결제 · ' || to_char(new.expected_amount, 'FM999,999,999,990') || '원'
  );
  return new;
end;
$$;

create or replace function app_private.notify_shipping_payment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_context = 'auction_bundle' then return new; end if;
  perform app_private.insert_owner_payment_notification(
    case new.payment_context
      when 'shipping_credit' then '배송 크레딧 결제'
      else '배송비 결제'
    end || ' · ' || to_char(new.expected_amount, 'FM999,999,999,990') || '원'
  );
  return new;
end;
$$;

revoke all on function app_private.notify_combined_auction_payment_request()
from public, anon, authenticated, service_role;
revoke all on function app_private.notify_commerce_transfer_request()
from public, anon, authenticated, service_role;
revoke all on function app_private.notify_shipping_payment_request()
from public, anon, authenticated, service_role;

create or replace function app_private.notification_preference_allows(
  p_user_id uuid,
  p_kind text,
  p_delivery text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      preferences.consent_state = 'granted'
      and case p_delivery
        when 'background' then preferences.background_push_enabled
        else preferences.foreground_enabled
      end
      and case lower(p_kind)
        when 'auction_won' then preferences.auction_enabled
        when 'auction_outbid' then preferences.auction_enabled
        when 'auction_drop_alert' then preferences.auction_enabled
        when 'chat_message' then preferences.chat_enabled
        when 'shipment_tracking_registered' then preferences.shipment_enabled
        when 'vault_expiring_soon' then preferences.shipment_enabled
        when 'payment_verification_requested' then preferences.payment_verification_enabled
        when 'shipping_requested' then preferences.shipping_request_enabled
        else preferences.system_enabled
      end
    from public.notification_preferences as preferences
    where preferences.user_id = p_user_id
  ), false);
$$;

revoke all on function app_private.notification_preference_allows(uuid, text, text)
from public, anon, authenticated, service_role;

commit;

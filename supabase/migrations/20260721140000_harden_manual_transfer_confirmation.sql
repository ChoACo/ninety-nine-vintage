-- Manual-transfer receipts are authoritative for every settlement transition.
-- Browser retries are deduplicated by an operator-scoped UUID v4 key, while
-- all parent/ledger mutations use one canonical lock order per payment kind.

-- This phase intentionally requires a quiet receipt-maintenance window. Phase
-- zero installs a ledger-state fence and deactivates the
-- process-auction-purchase-offers pg_cron job; phase one verifies it has
-- drained in a prior committed maintenance step. Keep every application
-- settlement writer stopped until this phase commits. The cron job is restored
-- only at the successful end of this transaction.
do $$
declare
  v_job_id bigint;
  v_job_count integer;
  v_snapshot_count integer;
  v_snapshot_job_id bigint;
  v_snapshot_job_name text;
  v_original_schedule text;
  v_original_command text;
  v_original_database text;
  v_original_username text;
  v_current_schedule text;
  v_current_command text;
  v_current_database text;
  v_current_username text;
  v_current_active boolean;
begin
  if coalesce(current_setting('cron.log_run', true), 'off') <> 'on' then
    raise exception using
      errcode = '55000',
      message = '경매 cron 드레인 검증을 위해 cron.log_run=on이 필요합니다.';
  end if;

  lock table cron.job in share row exclusive mode nowait;

  select count(*)::integer
  into v_snapshot_count
  from app_private.manual_transfer_cron_rollout_state as rollout
  where rollout.singleton
    and rollout.restored_at is null;

  if v_snapshot_count <> 1 then
    raise exception using
      errcode = '55000',
      message = '복원되지 않은 경매 cron 원상태 snapshot은 정확히 하나여야 합니다.';
  end if;

  select
    rollout.job_id,
    rollout.job_name,
    rollout.original_schedule,
    rollout.original_command,
    rollout.original_database,
    rollout.original_username
  into
    v_snapshot_job_id,
    v_snapshot_job_name,
    v_original_schedule,
    v_original_command,
    v_original_database,
    v_original_username
  from app_private.manual_transfer_cron_rollout_state as rollout
  where rollout.singleton
    and rollout.restored_at is null
  for share;

  select count(*)::integer
  into v_job_count
  from cron.job as jobs
  where jobs.jobname = v_snapshot_job_name;

  if v_job_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'snapshot에 기록된 경매 cron은 정확히 하나여야 합니다.';
  end if;

  select
    jobs.jobid,
    jobs.schedule,
    jobs.command,
    jobs.database,
    jobs.username,
    jobs.active
  into
    v_job_id,
    v_current_schedule,
    v_current_command,
    v_current_database,
    v_current_username,
    v_current_active
  from cron.job as jobs
  where jobs.jobname = v_snapshot_job_name
  for update;

  if v_job_id is distinct from v_snapshot_job_id
     or v_current_schedule is distinct from v_original_schedule
     or v_current_command is distinct from v_original_command
     or v_current_database is distinct from v_original_database
     or v_current_username is distinct from v_original_username
     or v_current_active is distinct from false then
    raise exception using
      errcode = '55000',
      message = '수동 입금 계약 변경 중인 경매 cron이 snapshot 원상태와 일치하지 않습니다.';
  end if;

  if exists (
    select 1
    from cron.job_run_details as runs
    where runs.jobid = v_job_id
      and runs.end_time is null
      and runs.status in ('starting', 'connecting', 'sending', 'running')
  ) or exists (
    select 1
    from pg_catalog.pg_stat_activity as activity
    where activity.pid <> pg_backend_pid()
      and activity.state <> 'idle'
      and activity.query ilike '%process_auction_purchase_offers%'
  ) then
    raise exception using
      errcode = '55P03',
      message = '실행 중인 경매 구매 제안 정산 작업이 끝난 뒤 다시 시도해 주세요.';
  end if;
end;
$$;

-- NOWAIT prevents this phase from queuing behind an unexpected writer. It can
-- be retried after that writer is stopped without mixing old and new contracts.
lock table
  public.products,
  public.auction_purchase_offers,
  public.manual_transfer_orders,
  public.commerce_orders,
  public.commerce_order_items,
  public.commerce_order_transfers,
  public.shipping_fee_payments
in exclusive mode nowait;

lock table public.manual_transfer_payment_ledger
in access exclusive mode nowait;

alter table public.manual_transfer_payment_ledger
  add column if not exists idempotency_key text;

-- A partial auction receipt suspends automatic expiry. Preserve the exact
-- deadlines that existed when the hold began; recalculating them later would
-- depend on mutable settings and the current clock. The marker distinguishes
-- an intentional hold whose original deadlines were NULL from no hold at all.
alter table public.manual_transfer_orders
  add column if not exists payment_deadline_held_at timestamptz,
  add column if not exists due_at_before_payment_hold timestamptz,
  add column if not exists offer_due_at_before_payment_hold timestamptz;

-- One fixed-price cart can contain many individually bounded products, so its
-- unified receipt can legitimately exceed the legacy per-item ceiling. Keep
-- the historical ceiling for auction and shipping receipts.
alter table public.manual_transfer_payment_ledger
  drop constraint if exists manual_transfer_payment_ledger_amount_check;
alter table public.manual_transfer_payment_ledger
  add constraint manual_transfer_payment_ledger_amount_check
  check (
    amount > 0
    and (transfer_kind = 'commerce' or amount <= 1000000000)
  );

update public.manual_transfer_payment_ledger
set idempotency_key = 'legacy:' || id::text
where entry_type = 'receipt'
  and idempotency_key is null;

alter table public.manual_transfer_payment_ledger
  drop constraint if exists manual_transfer_payment_ledger_idempotency_contract_check;
alter table public.manual_transfer_payment_ledger
  add constraint manual_transfer_payment_ledger_idempotency_contract_check
  check (
    (
      entry_type = 'receipt'
      and idempotency_key is not null
      and (
        idempotency_key = 'legacy:' || id::text
        or idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
    or (entry_type = 'reversal' and idempotency_key is null)
  );

create unique index if not exists manual_transfer_payment_ledger_receipt_idempotency_idx
  on public.manual_transfer_payment_ledger (recorded_by, idempotency_key)
  where entry_type = 'receipt';

-- Refuse to deploy over already-inconsistent receipt totals. Historical rows
-- are not silently repaired because the ledger must remain auditable.
do $$
begin
  if exists (
    select 1
    from public.commerce_order_transfers as transfers
    left join lateral (
      select coalesce(sum(
        case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
      ), 0)::bigint as received_amount
      from public.manual_transfer_payment_ledger as ledger
      where ledger.commerce_order_transfer_id = transfers.id
    ) as totals on true
    where totals.received_amount < 0
       or totals.received_amount > transfers.expected_amount
       or (transfers.status = 'awaiting_transfer' and totals.received_amount <> 0)
       or (
         transfers.status = 'partially_paid'
         and totals.received_amount not between 1 and transfers.expected_amount - 1
       )
       or (transfers.status = 'confirmed' and totals.received_amount <> transfers.expected_amount)
       or (transfers.status = 'cancelled' and totals.received_amount <> 0)
  ) or exists (
    select 1
    from public.manual_transfer_orders as orders
    left join lateral (
      select coalesce(sum(
        case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
      ), 0)::bigint as received_amount
      from public.manual_transfer_payment_ledger as ledger
      where ledger.manual_transfer_order_id = orders.id
    ) as totals on true
    where totals.received_amount < 0
       or totals.received_amount > orders.expected_amount
       or (
         orders.status = 'awaiting_manual_transfer'
         and totals.received_amount >= orders.expected_amount
       )
       or (orders.status = 'confirmed' and totals.received_amount <> orders.expected_amount)
       or (orders.status = 'cancelled_unpaid' and totals.received_amount <> 0)
  ) or exists (
    select 1
    from public.shipping_fee_payments as payments
    left join lateral (
      select coalesce(sum(
        case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
      ), 0)::bigint as received_amount
      from public.manual_transfer_payment_ledger as ledger
      where ledger.shipping_fee_payment_id = payments.id
    ) as totals on true
    where totals.received_amount < 0
       or totals.received_amount > payments.expected_amount
       or (payments.status = 'awaiting_transfer' and totals.received_amount <> 0)
       or (
         payments.status = 'partially_paid'
         and totals.received_amount not between 1 and payments.expected_amount - 1
       )
       or (payments.status = 'confirmed' and totals.received_amount <> payments.expected_amount)
       or (payments.status = 'cancelled' and totals.received_amount <> 0)
  ) then
    raise exception using
      errcode = '23514',
      message = '기존 수동 입금 원장의 무결성 검토가 필요합니다.';
  end if;
end;
$$;

-- A linked auction waiting for payment must still have an actionable offer.
-- This includes a zero balance left by the legacy reversal RPC: that RPC could
-- reopen the order without reverting a settled offer, which would strand every
-- future receipt. Existing partial receipts are then placed on an explicit
-- financial hold before pg_cron is restored. Invalid state fails the migration
-- so an operator can reconcile it rather than silently changing ownership.
do $$
begin
  if exists (
    select 1
    from public.manual_transfer_orders as orders
    join public.auction_purchase_offers as offers
      on offers.id = orders.purchase_offer_id
    join lateral (
      select coalesce(sum(
        case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
      ), 0)::bigint as received_amount
      from public.manual_transfer_payment_ledger as ledger
      where ledger.manual_transfer_order_id = orders.id
    ) as totals on true
    where orders.status = 'awaiting_manual_transfer'
      and totals.received_amount between 0 and orders.expected_amount - 1
      and offers.status not in ('payment_due', 'accepted')
  ) then
    raise exception using
      errcode = '23514',
      message = '입금 대기 낙찰 제안의 상태를 먼저 검토해야 합니다.';
  end if;
end;
$$;

update public.manual_transfer_orders as orders
set payment_deadline_held_at = clock_timestamp(),
    due_at_before_payment_hold = orders.due_at,
    offer_due_at_before_payment_hold = (
      select offers.payment_due_at
      from public.auction_purchase_offers as offers
      where offers.id = orders.purchase_offer_id
    ),
    due_at = null
from (
  select
    ledger.manual_transfer_order_id,
    coalesce(sum(
    case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
    ), 0)::bigint as received_amount
  from public.manual_transfer_payment_ledger as ledger
  where ledger.manual_transfer_order_id is not null
  group by ledger.manual_transfer_order_id
) as totals
where totals.manual_transfer_order_id = orders.id
  and orders.status = 'awaiting_manual_transfer'
  and totals.received_amount between 1 and orders.expected_amount - 1;

update public.auction_purchase_offers as offers
set payment_due_at = null
from public.manual_transfer_orders as orders
where offers.id = orders.purchase_offer_id
  and orders.status = 'awaiting_manual_transfer'
  and orders.payment_deadline_held_at is not null;

alter table public.manual_transfer_orders
  drop constraint if exists manual_transfer_orders_payment_deadline_hold_check;
alter table public.manual_transfer_orders
  add constraint manual_transfer_orders_payment_deadline_hold_check check (
    (
      payment_deadline_held_at is null
      and due_at_before_payment_hold is null
      and offer_due_at_before_payment_hold is null
    )
    or (
      payment_deadline_held_at is not null
      and due_at is null
      and (
        purchase_offer_id is not null
        or offer_due_at_before_payment_hold is null
      )
    )
  );

create or replace function public.enforce_manual_transfer_ledger_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_received bigint;
  v_valid boolean := false;
begin
  if tg_table_name = 'commerce_order_transfers' then
    select coalesce(sum(
      case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
    ), 0)::bigint
    into v_received
    from public.manual_transfer_payment_ledger as ledger
    where ledger.commerce_order_transfer_id = new.id;
  elsif tg_table_name = 'manual_transfer_orders' then
    select coalesce(sum(
      case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
    ), 0)::bigint
    into v_received
    from public.manual_transfer_payment_ledger as ledger
    where ledger.manual_transfer_order_id = new.id;
  elsif tg_table_name = 'shipping_fee_payments' then
    select coalesce(sum(
      case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
    ), 0)::bigint
    into v_received
    from public.manual_transfer_payment_ledger as ledger
    where ledger.shipping_fee_payment_id = new.id;
  else
    raise exception using errcode = '55000', message = '지원하지 않는 수동 입금 확정 대상입니다.';
  end if;

  if tg_table_name = 'manual_transfer_orders' then
    v_valid :=
      (
        new.status = 'awaiting_manual_transfer'
        and v_received = 0
        and new.payment_deadline_held_at is null
        and new.due_at_before_payment_hold is null
        and new.offer_due_at_before_payment_hold is null
      )
      or (
        new.status = 'awaiting_manual_transfer'
        and v_received between 1 and new.expected_amount - 1
        and new.payment_deadline_held_at is not null
        and new.due_at is null
      )
      or (new.status = 'confirmed' and v_received = new.expected_amount)
      or (
        new.status = 'cancelled_unpaid'
        and v_received = 0
        and new.payment_deadline_held_at is null
        and new.due_at_before_payment_hold is null
        and new.offer_due_at_before_payment_hold is null
      );
  else
    v_valid :=
      (new.status = 'awaiting_transfer' and v_received = 0)
      or (new.status = 'partially_paid' and v_received between 1 and new.expected_amount - 1)
      or (new.status = 'confirmed' and v_received = new.expected_amount)
      or (new.status = 'cancelled' and v_received = 0);
  end if;

  if not v_valid then
    raise exception using
      errcode = '55000',
      message = '수동 입금 상태와 원장 누적액이 일치하지 않습니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_manual_transfer_ledger_confirmation()
from public, anon, authenticated, service_role;

drop trigger if exists commerce_transfer_requires_settled_ledger
  on public.commerce_order_transfers;
create trigger commerce_transfer_requires_settled_ledger
before insert or update on public.commerce_order_transfers
for each row execute function public.enforce_manual_transfer_ledger_confirmation();

drop trigger if exists auction_transfer_requires_settled_ledger
  on public.manual_transfer_orders;
create trigger auction_transfer_requires_settled_ledger
before insert or update on public.manual_transfer_orders
for each row execute function public.enforce_manual_transfer_ledger_confirmation();

drop trigger if exists shipping_fee_requires_settled_ledger
  on public.shipping_fee_payments;
create trigger shipping_fee_requires_settled_ledger
before insert or update on public.shipping_fee_payments
for each row execute function public.enforce_manual_transfer_ledger_confirmation();

-- Staff payment operations use the audited projections below. Do not leave a
-- second, broader direct-table read path that exposes whole cross-store rows.
drop policy if exists "Members read their commerce orders"
  on public.commerce_orders;
create policy "Members read their commerce orders"
  on public.commerce_orders for select to authenticated
  using (member_id = auth.uid());

drop policy if exists "Members read their commerce items"
  on public.commerce_order_items;
create policy "Members read their commerce items"
  on public.commerce_order_items for select to authenticated
  using (
    exists (
      select 1
      from public.commerce_orders as orders
      where orders.id = order_id
        and orders.member_id = auth.uid()
    )
  );

drop policy if exists "Members read commerce order transfers"
  on public.commerce_order_transfers;
create policy "Members read commerce order transfers"
  on public.commerce_order_transfers for select to authenticated
  using (member_id = auth.uid());

drop policy if exists "Members read their manual transfer ledger"
  on public.manual_transfer_payment_ledger;
create policy "Members read their manual transfer ledger"
  on public.manual_transfer_payment_ledger for select to authenticated
  using (
    exists (
      select 1
      from public.manual_transfer_orders as auction_orders
      where auction_orders.id = manual_transfer_order_id
        and auction_orders.buyer_id = auth.uid()
    )
    or exists (
      select 1
      from public.commerce_order_transfers as commerce_transfers
      where commerce_transfers.id = commerce_order_transfer_id
        and commerce_transfers.member_id = auth.uid()
    )
    or exists (
      select 1
      from public.shipping_fee_payments as shipping_payments
      where shipping_payments.id = shipping_fee_payment_id
        and shipping_payments.member_id = auth.uid()
    )
  );

-- Balance/version reads are aggregated in PostgreSQL so PostgREST max_rows can
-- never truncate the state used by the receipt compare-and-swap contract.
create or replace function public.get_manual_transfer_ledger_balances(
  p_transfer_kind text,
  p_transfer_ids uuid[]
)
returns table (
  transfer_id uuid,
  received_amount bigint,
  ledger_entry_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_transfer_kind is null
    or p_transfer_kind not in ('auction', 'commerce', 'shipping')
    or coalesce(array_length(p_transfer_ids, 1), 0) = 0
    or array_length(p_transfer_ids, 1) > 500
    or array_position(p_transfer_ids, null) is not null
  then
    raise exception using errcode = '22023', message = '조회할 입금 원장을 확인해 주세요.';
  end if;

  if p_transfer_kind = 'commerce' then
    return query
    select
      transfers.id,
      coalesce(sum(
        case
          when ledger.entry_type = 'receipt' then ledger.amount
          when ledger.entry_type = 'reversal' then -ledger.amount
          else 0
        end
      ), 0)::bigint,
      count(ledger.id)::bigint
    from public.commerce_order_transfers as transfers
    left join public.manual_transfer_payment_ledger as ledger
      on ledger.commerce_order_transfer_id = transfers.id
    where transfers.id = any(p_transfer_ids)
    group by transfers.id;
    return;
  end if;

  if p_transfer_kind = 'auction' then
    return query
    select
      orders.id,
      coalesce(sum(
        case
          when ledger.entry_type = 'receipt' then ledger.amount
          when ledger.entry_type = 'reversal' then -ledger.amount
          else 0
        end
      ), 0)::bigint,
      count(ledger.id)::bigint
    from public.manual_transfer_orders as orders
    join public.products as products on products.id = orders.product_id
    join public.stores as stores on stores.id = products.store_id
    left join public.manual_transfer_payment_ledger as ledger
      on ledger.manual_transfer_order_id = orders.id
    where orders.id = any(p_transfer_ids)
      and (
        public.is_owner()
        or (
          stores.operator_id = v_actor
          and not exists (
            select 1
            from public.owner_hidden_test_members as hidden_test_members
            where hidden_test_members.test_user_id = orders.buyer_id
          )
        )
      )
    group by orders.id;
    return;
  end if;

  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  return query
  select
    payments.id,
    coalesce(sum(
      case
        when ledger.entry_type = 'receipt' then ledger.amount
        when ledger.entry_type = 'reversal' then -ledger.amount
        else 0
      end
    ), 0)::bigint,
    count(ledger.id)::bigint
  from public.shipping_fee_payments as payments
  left join public.manual_transfer_payment_ledger as ledger
    on ledger.shipping_fee_payment_id = payments.id
  where payments.id = any(p_transfer_ids)
  group by payments.id;
end;
$$;

revoke all on function public.get_manual_transfer_ledger_balances(text, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.get_manual_transfer_ledger_balances(text, uuid[])
to authenticated;

-- Return one bounded row per order, with its at-most-50 checkout items nested
-- as JSON. PostgREST max_rows therefore cannot silently truncate the product
-- evidence an operator uses to match a shared payment.
create or replace function public.get_shared_commerce_payment_order_summaries(
  p_order_ids uuid[]
)
returns table (
  order_id uuid,
  member_id uuid,
  order_status text,
  total bigint,
  created_at timestamptz,
  item_count bigint,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0
    or array_length(p_order_ids, 1) > 500
    or array_position(p_order_ids, null) is not null
  then
    raise exception using errcode = '22023', message = '조회할 통합 주문을 확인해 주세요.';
  end if;

  return query
  select
    orders.id,
    orders.member_id,
    orders.status,
    orders.total,
    orders.created_at,
    count(order_items.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_id', order_items.order_id,
          'product_id', order_items.product_id,
          'unit_price', order_items.unit_price,
          'payment_status', order_items.payment_status,
          'products', jsonb_build_object(
            'title', products.title,
            'image_urls', products.image_urls
          ),
          'commerce_orders', jsonb_build_object(
            'member_id', orders.member_id,
            'status', orders.status,
            'total', orders.total,
            'created_at', orders.created_at
          )
        )
        order by order_items.created_at, order_items.id
      ) filter (where order_items.id is not null),
      '[]'::jsonb
    )
  from public.commerce_orders as orders
  left join public.commerce_order_items as order_items
    on order_items.order_id = orders.id
  left join public.products as products
    on products.id = order_items.product_id
  where orders.id = any(p_order_ids)
  group by orders.id;
end;
$$;

revoke all on function public.get_shared_commerce_payment_order_summaries(uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.get_shared_commerce_payment_order_summaries(uuid[])
to authenticated;

-- The legacy auction operations projection is still directly callable even
-- though the current console no longer uses it. Match its read scope to the
-- auction receipt mutation: Owner sees every store; an operator sees only the
-- store they own, and hidden Owner test members remain Owner-only.
create or replace function public.get_pending_manual_transfers(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  product_id uuid,
  buyer_id uuid,
  buyer_display_name text,
  product_title text,
  image_urls text[],
  bank_name text,
  account_number text,
  expected_amount bigint,
  status text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz,
  total_count bigint,
  due_at timestamptz,
  purchase_offer_kind text,
  purchase_offer_status text,
  purchase_offer_round integer,
  payment_deadline_exempt boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '입금 확인 권한이 없습니다.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 1000000 then
    raise exception using errcode = '22023', message = '조회 범위를 확인해 주세요.';
  end if;

  return query
  select
    manual_orders.id,
    manual_orders.product_id,
    manual_orders.buyer_id,
    coalesce(profiles.display_name, '탈퇴 회원'),
    products.title,
    products.image_urls,
    manual_orders.bank_name_snapshot,
    manual_orders.account_number_snapshot,
    manual_orders.expected_amount,
    manual_orders.status,
    manual_orders.requested_at,
    manual_orders.confirmed_at,
    manual_orders.updated_at,
    count(*) over (),
    manual_orders.due_at,
    offers.offer_kind,
    offers.status,
    offers.offer_round,
    public.is_payment_deadline_exempt(manual_orders.buyer_id)
  from public.manual_transfer_orders as manual_orders
  join public.products as products
    on products.id = manual_orders.product_id
  join public.stores as stores
    on stores.id = products.store_id
  left join public.profiles as profiles
    on profiles.id = manual_orders.buyer_id
  left join public.auction_purchase_offers as offers
    on offers.id = manual_orders.purchase_offer_id
  where manual_orders.status = 'awaiting_manual_transfer'
    and (
      public.is_owner()
      or (
        stores.operator_id = v_actor
        and not exists (
          select 1
          from public.owner_hidden_test_members as hidden_test_members
          where hidden_test_members.test_user_id = manual_orders.buyer_id
        )
      )
    )
  order by manual_orders.due_at nulls last, manual_orders.requested_at,
    manual_orders.id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_pending_manual_transfers(integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_pending_manual_transfers(integer, integer)
to authenticated;

create or replace function public.confirm_commerce_order_transfer(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_received bigint;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_order_id is null then
    raise exception using errcode = '22023', message = '확정할 주문을 선택해 주세요.';
  end if;

  select orders.* into v_order
  from public.commerce_orders as orders
  where orders.id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '주문을 찾을 수 없습니다.';
  end if;

  select transfers.* into v_transfer
  from public.commerce_order_transfers as transfers
  where transfers.order_id = p_order_id
  for update;
  if not found or v_transfer.status = 'cancelled' then
    raise exception using errcode = '22023', message = '입금 대기 내역을 찾을 수 없습니다.';
  end if;
  if v_transfer.member_id is distinct from v_order.member_id
    or v_transfer.expected_amount is distinct from v_order.total
  then
    raise exception using errcode = '23514', message = '주문과 입금 요청의 금액 계약이 일치하지 않습니다.';
  end if;

  select coalesce(sum(
    case when entry_type = 'receipt' then amount else -amount end
  ), 0)::bigint
  into v_received
  from public.manual_transfer_payment_ledger as ledger
  where ledger.commerce_order_transfer_id = v_transfer.id;

  if v_received <> v_transfer.expected_amount then
    raise exception using
      errcode = '55000',
      message = '입금 원장 누적액이 주문 예정액과 일치하지 않습니다.';
  end if;
  if v_transfer.status = 'confirmed' then
    return true;
  end if;

  update public.commerce_order_transfers
  set status = 'confirmed', confirmed_at = v_now, confirmed_by = v_actor
  where id = v_transfer.id;

  update public.commerce_order_items as items
  set payment_status = 'paid',
      paid_at = v_now,
      storage_expires_at = v_now + case
        when products.storage_class = 'large' then interval '7 days'
        else interval '14 days'
      end
  from public.products as products
  where items.order_id = p_order_id
    and products.id = items.product_id;

  update public.commerce_orders
  set status = 'paid', updated_at = v_now
  where id = p_order_id;

  insert into public.notifications (member_id, audience_role, kind, title, body, href)
  values (
    v_order.member_id,
    'member',
    'payment_confirmed',
    '입금이 확인되었습니다.',
    '주문 상품이 보관 목록에 추가되었습니다.',
    '/account#storage'
  );
  return true;
end;
$$;

revoke all on function public.confirm_commerce_order_transfer(uuid)
from public, anon, authenticated, service_role;

-- Auction confirmation is also internal-only. The ledger trigger above checks
-- its amount before the existing settlement function can change the status.
revoke all on function public.confirm_manual_transfer(uuid, timestamptz)
from public, anon, authenticated, service_role;

revoke all on function public.record_manual_transfer_payment(text, uuid, bigint, text, text)
from public, anon, authenticated, service_role;
drop function public.record_manual_transfer_payment(text, uuid, bigint, text, text);

create or replace function public.record_manual_transfer_payment(
  p_transfer_kind text,
  p_transfer_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_idempotency_key, '')));
  v_expected bigint;
  v_received bigint;
  v_ledger_entry_count integer;
  v_order_id uuid;
  v_product_id uuid;
  v_purchase_offer_id uuid;
  v_status text;
  v_ledger_id uuid;
  v_existing public.manual_transfer_payment_ledger%rowtype;
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_auction public.manual_transfer_orders%rowtype;
  v_offer public.auction_purchase_offers%rowtype;
  v_settings public.payment_runtime_settings%rowtype;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_transfer_kind is null
    or p_transfer_kind not in ('auction', 'commerce')
    or p_transfer_id is null
  then
    raise exception using errcode = '22023', message = '입금 대상을 선택해 주세요.';
  end if;
  if p_amount is null
    or p_amount < 1
    or (p_transfer_kind = 'auction' and p_amount > 1000000000)
  then
    raise exception using errcode = '22023', message = '입금액이 올바르지 않습니다.';
  end if;
  if p_expected_received_amount is null
    or p_expected_received_amount < 0
  then
    raise exception using errcode = '22023', message = '현재 누적 입금액이 올바르지 않습니다.';
  end if;
  if p_expected_ledger_entry_count is null
    or p_expected_ledger_entry_count < 0
  then
    raise exception using errcode = '22023', message = '현재 입금 원장 버전이 올바르지 않습니다.';
  end if;
  if nullif(btrim(coalesce(p_depositor_name, '')), '') is null
    or char_length(btrim(p_depositor_name)) > 80
  then
    raise exception using errcode = '22023', message = '입금자명을 입력해 주세요.';
  end if;
  if char_length(coalesce(p_memo, '')) > 500 then
    raise exception using errcode = '22023', message = '메모는 500자 이하로 입력해 주세요.';
  end if;
  if v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = '입금 요청 키가 올바르지 않습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-transfer-receipt:' || v_actor::text || ':' || v_key, 0)
  );

  select ledger.* into v_existing
  from public.manual_transfer_payment_ledger as ledger
  where ledger.recorded_by = v_actor
    and ledger.idempotency_key = v_key
    and ledger.entry_type = 'receipt';

  if found then
    if v_existing.transfer_kind is distinct from p_transfer_kind
      or v_existing.amount is distinct from p_amount
      or v_existing.depositor_name is distinct from btrim(p_depositor_name)
      or v_existing.memo is distinct from btrim(coalesce(p_memo, ''))
      or (
        p_transfer_kind = 'commerce'
        and v_existing.commerce_order_transfer_id is distinct from p_transfer_id
      )
      or (
        p_transfer_kind = 'auction'
        and v_existing.manual_transfer_order_id is distinct from p_transfer_id
      )
    then
      raise exception using
        errcode = '23505',
        message = '동일한 입금 요청 키를 다른 내용으로 재사용할 수 없습니다.';
    end if;

    if p_transfer_kind = 'commerce' then
      select transfers.* into v_transfer
      from public.commerce_order_transfers as transfers
      where transfers.id = p_transfer_id;
      v_expected := v_transfer.expected_amount;
    else
      select orders.* into v_auction
      from public.manual_transfer_orders as orders
      where orders.id = p_transfer_id;
      v_expected := v_auction.expected_amount;
    end if;
    if v_expected is null then
      raise exception using errcode = 'P0002', message = '입금 대상을 찾지 못했습니다.';
    end if;
    if p_transfer_kind = 'auction' and not public.is_owner() and (
      not exists (
        select 1
        from public.products as products
        join public.stores as stores on stores.id = products.store_id
        where products.id = v_auction.product_id and stores.operator_id = v_actor
      )
      or exists (
        select 1
        from public.owner_hidden_test_members as hidden_test_members
        where hidden_test_members.test_user_id = v_auction.buyer_id
      )
    ) then
      raise exception using errcode = '42501', message = '이 낙찰 건의 입금을 처리할 권한이 없습니다.';
    end if;

    select
      coalesce(sum(
        case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
      ), 0)::bigint,
      count(*)::integer
    into v_received, v_ledger_entry_count
    from public.manual_transfer_payment_ledger as ledger
    where (p_transfer_kind = 'commerce' and ledger.commerce_order_transfer_id = p_transfer_id)
       or (p_transfer_kind = 'auction' and ledger.manual_transfer_order_id = p_transfer_id);
    v_status := case
      when v_received = v_expected then 'confirmed'
      when v_received > 0 then 'partially_paid'
      when p_transfer_kind = 'auction' then v_auction.status
      else v_transfer.status
    end;
    return jsonb_build_object(
      'transfer_kind', p_transfer_kind,
      'transfer_id', p_transfer_id,
      'ledger_id', v_existing.id,
      'received_amount', v_received,
      'remaining_amount', v_expected - v_received,
      'ledger_entry_count', v_ledger_entry_count,
      'status', v_status,
      'idempotent_replay', true
    );
  end if;

  select settings.* into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for update;
  if not found or v_settings.active_mode <> 'manual_transfer' then
    raise exception using
      errcode = 'PT409',
      message = '수동 계좌이체 모드에서만 입금 원장을 기록할 수 있습니다.';
  end if;

  if p_transfer_kind = 'commerce' then
    select transfers.order_id into v_order_id
    from public.commerce_order_transfers as transfers
    where transfers.id = p_transfer_id;
    if v_order_id is null then
      raise exception using errcode = 'P0002', message = '입금 대기 주문을 찾지 못했습니다.';
    end if;

    select orders.* into v_order
    from public.commerce_orders as orders
    where orders.id = v_order_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '주문을 찾지 못했습니다.';
    end if;
    if v_order.status not in ('awaiting_payment', 'partially_paid') then
      raise exception using errcode = '55000', message = '입금 대기 중인 주문이 아닙니다.';
    end if;

    select transfers.* into v_transfer
    from public.commerce_order_transfers as transfers
    where transfers.id = p_transfer_id
      and transfers.order_id = v_order_id
    for update;
    if not found or v_transfer.status not in ('awaiting_transfer', 'partially_paid') then
      raise exception using errcode = '55000', message = '입금 대기 주문을 찾지 못했습니다.';
    end if;
    if v_transfer.member_id is distinct from v_order.member_id
      or v_transfer.expected_amount is distinct from v_order.total
    then
      raise exception using errcode = '23514', message = '주문과 입금 요청의 금액 계약이 일치하지 않습니다.';
    end if;
    if not exists (
      select 1 from public.commerce_order_items as items where items.order_id = v_order_id
    ) then
      raise exception using errcode = '23514', message = '주문 상품이 없어 입금을 처리할 수 없습니다.';
    end if;
    v_expected := v_transfer.expected_amount;
  else
    select orders.product_id, orders.purchase_offer_id
    into v_product_id, v_purchase_offer_id
    from public.manual_transfer_orders as orders
    where orders.id = p_transfer_id;
    if v_product_id is null then
      raise exception using errcode = 'P0002', message = '낙찰 입금 대기 건을 찾지 못했습니다.';
    end if;

    perform 1 from public.products as products
    where products.id = v_product_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '경매 상품을 찾지 못했습니다.';
    end if;

    if v_purchase_offer_id is not null then
      select offers.* into v_offer
      from public.auction_purchase_offers as offers
      where offers.id = v_purchase_offer_id
        and offers.product_id = v_product_id
      for update;
      if not found then
        raise exception using errcode = 'P0002', message = '낙찰 구매 제안을 찾지 못했습니다.';
      end if;
    end if;

    select orders.* into v_auction
    from public.manual_transfer_orders as orders
    where orders.id = p_transfer_id
      and orders.product_id = v_product_id
      and orders.purchase_offer_id is not distinct from v_purchase_offer_id
    for update;
    if not found or v_auction.status <> 'awaiting_manual_transfer' then
      raise exception using errcode = '55000', message = '낙찰 입금 대기 건을 찾지 못했습니다.';
    end if;
    if not public.is_owner() and (
      not exists (
        select 1
        from public.products as products
        join public.stores as stores on stores.id = products.store_id
        where products.id = v_product_id and stores.operator_id = v_actor
      )
      or exists (
        select 1
        from public.owner_hidden_test_members as hidden_test_members
        where hidden_test_members.test_user_id = v_auction.buyer_id
      )
    ) then
      raise exception using errcode = '42501', message = '이 낙찰 건의 입금을 처리할 권한이 없습니다.';
    end if;
    if public.is_owner_hidden_test_member(v_auction.buyer_id) then
      perform set_config('app.owner_hidden_test_actor', v_actor::text, true);
    end if;
    v_expected := v_auction.expected_amount;
  end if;

  select
    coalesce(sum(
      case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
    ), 0)::bigint,
    count(*)::integer
  into v_received, v_ledger_entry_count
  from public.manual_transfer_payment_ledger as ledger
  where (p_transfer_kind = 'commerce' and ledger.commerce_order_transfer_id = p_transfer_id)
     or (p_transfer_kind = 'auction' and ledger.manual_transfer_order_id = p_transfer_id);
  if v_received is distinct from p_expected_received_amount
    or v_ledger_entry_count is distinct from p_expected_ledger_entry_count
  then
    raise exception using
      errcode = 'PT409',
      message = '다른 운영자가 입금 원장을 변경했습니다. 목록을 새로고침한 뒤 다시 입력해 주세요.';
  end if;
  if p_transfer_kind = 'auction' and (
    (
      v_received = 0
      and (
        v_auction.payment_deadline_held_at is not null
        or v_auction.due_at_before_payment_hold is not null
        or v_auction.offer_due_at_before_payment_hold is not null
      )
    )
    or (
      v_received between 1 and v_expected - 1
      and (
        v_auction.payment_deadline_held_at is null
        or v_auction.due_at is not null
        or (
          v_purchase_offer_id is not null
          and v_offer.payment_due_at is not null
        )
      )
    )
  ) then
    raise exception using
      errcode = '23514',
      message = '낙찰 부분입금의 기한 보류 상태를 먼저 검토해야 합니다.';
  end if;
  if p_transfer_kind = 'auction' and (
    (v_auction.due_at is not null and clock_timestamp() >= v_auction.due_at)
    or (
      v_purchase_offer_id is not null
      and (
        v_offer.status not in ('payment_due', 'accepted')
        or (
          v_offer.payment_due_at is not null
          and clock_timestamp() >= v_offer.payment_due_at
        )
      )
    )
  ) then
    raise exception using
      errcode = '55000',
      message = '입금 기한이 지나 자동 승계 검토가 필요한 낙찰 건입니다.';
  end if;
  if v_received + p_amount > v_expected then
    raise exception using errcode = '22003', message = '주문 잔액을 초과하는 입금액입니다.';
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind,
    manual_transfer_order_id,
    commerce_order_transfer_id,
    entry_type,
    amount,
    depositor_name,
    memo,
    recorded_by,
    idempotency_key
  ) values (
    p_transfer_kind,
    case when p_transfer_kind = 'auction' then p_transfer_id end,
    case when p_transfer_kind = 'commerce' then p_transfer_id end,
    'receipt',
    p_amount,
    btrim(p_depositor_name),
    btrim(coalesce(p_memo, '')),
    v_actor,
    v_key
  ) returning id into v_ledger_id;
  v_received := v_received + p_amount;
  v_ledger_entry_count := v_ledger_entry_count + 1;

  if p_transfer_kind = 'commerce' then
    if v_received = v_expected then
      perform public.confirm_commerce_order_transfer(v_order_id);
      v_status := 'confirmed';
    else
      update public.commerce_order_transfers
      set status = 'partially_paid'
      where id = p_transfer_id;
      update public.commerce_orders
      set status = 'partially_paid', updated_at = clock_timestamp()
      where id = v_order_id;
      v_status := 'partially_paid';
    end if;
  else
    if v_received = v_expected then
      perform public.confirm_manual_transfer(p_transfer_id, v_auction.updated_at);
      v_status := 'confirmed';
    else
      if v_purchase_offer_id is not null
        and v_auction.payment_deadline_held_at is null
      then
        update public.auction_purchase_offers
        set payment_due_at = null
        where id = v_purchase_offer_id;
      end if;
      update public.manual_transfer_orders
      set payment_deadline_held_at = case
            when v_auction.payment_deadline_held_at is null then clock_timestamp()
            else v_auction.payment_deadline_held_at
          end,
          due_at_before_payment_hold = case
            when v_auction.payment_deadline_held_at is null then v_auction.due_at
            else v_auction.due_at_before_payment_hold
          end,
          offer_due_at_before_payment_hold = case
            when v_auction.payment_deadline_held_at is null
              then case
                when v_purchase_offer_id is null then null
                else v_offer.payment_due_at
              end
            else v_auction.offer_due_at_before_payment_hold
          end,
          due_at = null
      where id = p_transfer_id;
      v_status := 'partially_paid';
    end if;
  end if;

  return jsonb_build_object(
    'transfer_kind', p_transfer_kind,
    'transfer_id', p_transfer_id,
    'ledger_id', v_ledger_id,
    'received_amount', v_received,
    'remaining_amount', v_expected - v_received,
    'ledger_entry_count', v_ledger_entry_count,
    'status', v_status,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.record_manual_transfer_payment(text, uuid, bigint, text, bigint, integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_manual_transfer_payment(text, uuid, bigint, text, bigint, integer, text, text)
to authenticated;

create or replace function public.reverse_manual_transfer_payment(
  p_ledger_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.manual_transfer_payment_ledger%rowtype;
  v_expected bigint;
  v_received bigint;
  v_order_id uuid;
  v_member_id uuid;
  v_product_id uuid;
  v_purchase_offer_id uuid;
  v_transfer_id uuid;
  v_manual_order_id uuid;
  v_status text;
  v_was_confirmed boolean := false;
  v_settings public.payment_runtime_settings%rowtype;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_ledger_id is null then
    raise exception using errcode = '22023', message = '취소할 입금 기록을 선택해 주세요.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(btrim(p_reason)) > 500
  then
    raise exception using errcode = '22023', message = '취소 사유를 입력해 주세요.';
  end if;

  select settings.* into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for update;
  if not found or v_settings.active_mode <> 'manual_transfer' then
    raise exception using
      errcode = 'PT409',
      message = '수동 계좌이체 모드에서만 입금 원장을 취소할 수 있습니다.';
  end if;

  -- Non-locking probe only. Every relationship is rechecked after canonical
  -- parent locks have been acquired.
  select ledger.* into v_entry
  from public.manual_transfer_payment_ledger as ledger
  where ledger.id = p_ledger_id
    and ledger.entry_type = 'receipt'
    and ledger.transfer_kind in ('commerce', 'auction');
  if not found then
    raise exception using errcode = 'P0002', message = '취소할 입금 기록을 찾지 못했습니다.';
  end if;

  if v_entry.transfer_kind = 'commerce' then
    v_transfer_id := v_entry.commerce_order_transfer_id;
    select transfers.order_id into v_order_id
    from public.commerce_order_transfers as transfers
    where transfers.id = v_transfer_id;
    if v_order_id is null then
      raise exception using errcode = 'P0002', message = '입금 주문을 찾지 못했습니다.';
    end if;

    select orders.member_id into v_member_id
    from public.commerce_orders as orders
    where orders.id = v_order_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '주문을 찾지 못했습니다.';
    end if;

    perform products.id
    from public.products as products
    join public.commerce_order_items as items on items.product_id = products.id
    where items.order_id = v_order_id
    order by products.id
    for update of products;
    if not found then
      raise exception using errcode = '23514', message = '주문 상품이 없어 입금 취소를 처리할 수 없습니다.';
    end if;

    select
      transfers.expected_amount,
      transfers.status = 'confirmed'
    into v_expected, v_was_confirmed
    from public.commerce_order_transfers as transfers
    where transfers.id = v_transfer_id
      and transfers.order_id = v_order_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '입금 요청을 찾지 못했습니다.';
    end if;

    select ledger.* into v_entry
    from public.manual_transfer_payment_ledger as ledger
    where ledger.id = p_ledger_id
      and ledger.entry_type = 'receipt'
      and ledger.transfer_kind = 'commerce'
      and ledger.commerce_order_transfer_id = v_transfer_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '취소할 입금 기록이 변경되었습니다.';
    end if;
    if exists (
      select 1
      from public.shipping_request_items as shipping_items
      join public.commerce_order_items as items
        on items.product_id = shipping_items.product_id
      where items.order_id = v_order_id
    ) then
      raise exception using errcode = '55000', message = '배송 접수된 주문은 자동 취소할 수 없습니다.';
    end if;
  else
    v_manual_order_id := v_entry.manual_transfer_order_id;
    select orders.product_id into v_product_id
    from public.manual_transfer_orders as orders
    where orders.id = v_manual_order_id;
    if v_product_id is null then
      raise exception using errcode = 'P0002', message = '낙찰 입금 주문을 찾지 못했습니다.';
    end if;

    perform 1 from public.products as products
    where products.id = v_product_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '경매 상품을 찾지 못했습니다.';
    end if;

    select orders.expected_amount, orders.purchase_offer_id, orders.buyer_id
    into v_expected, v_purchase_offer_id, v_member_id
    from public.manual_transfer_orders as orders
    where orders.id = v_manual_order_id
      and orders.product_id = v_product_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '낙찰 입금 주문을 찾지 못했습니다.';
    end if;
    if not public.is_owner() and (
      not exists (
        select 1
        from public.products as products
        join public.stores as stores on stores.id = products.store_id
        where products.id = v_product_id and stores.operator_id = v_actor
      )
      or exists (
        select 1
        from public.owner_hidden_test_members as hidden_test_members
        where hidden_test_members.test_user_id = v_member_id
      )
    ) then
      raise exception using errcode = '42501', message = '이 낙찰 건의 입금을 처리할 권한이 없습니다.';
    end if;
    if public.is_owner_hidden_test_member(v_member_id) then
      perform set_config('app.owner_hidden_test_actor', v_actor::text, true);
    end if;
    if v_purchase_offer_id is not null then
      raise exception using
        errcode = '55000',
        message = '구매 제안에 연결된 낙찰 입금은 전용 재정산 절차 없이 취소할 수 없습니다.';
    end if;

    select ledger.* into v_entry
    from public.manual_transfer_payment_ledger as ledger
    where ledger.id = p_ledger_id
      and ledger.entry_type = 'receipt'
      and ledger.transfer_kind = 'auction'
      and ledger.manual_transfer_order_id = v_manual_order_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '취소할 입금 기록이 변경되었습니다.';
    end if;
    if exists (
      select 1 from public.shipping_request_items where product_id = v_product_id
    ) then
      raise exception using errcode = '55000', message = '배송 접수된 낙찰 건은 자동 취소할 수 없습니다.';
    end if;
  end if;

  if exists (
    select 1
    from public.manual_transfer_payment_ledger as ledger
    where ledger.reversal_of = v_entry.id
  ) then
    raise exception using errcode = '55000', message = '이미 취소된 입금 기록입니다.';
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind,
    manual_transfer_order_id,
    commerce_order_transfer_id,
    entry_type,
    amount,
    memo,
    reversal_of,
    recorded_by,
    idempotency_key
  ) values (
    v_entry.transfer_kind,
    v_entry.manual_transfer_order_id,
    v_entry.commerce_order_transfer_id,
    'reversal',
    v_entry.amount,
    btrim(p_reason),
    v_entry.id,
    v_actor,
    null
  );

  select coalesce(sum(
    case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
  ), 0)::bigint
  into v_received
  from public.manual_transfer_payment_ledger as ledger
  where (v_entry.transfer_kind = 'commerce' and ledger.commerce_order_transfer_id = v_transfer_id)
     or (v_entry.transfer_kind = 'auction' and ledger.manual_transfer_order_id = v_manual_order_id);

  if v_entry.transfer_kind = 'commerce' then
    update public.commerce_order_transfers
    set status = case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end,
        confirmed_at = null,
        confirmed_by = null
    where id = v_transfer_id;
    update public.commerce_orders
    set status = case when v_received = 0 then 'awaiting_payment' else 'partially_paid' end,
        updated_at = clock_timestamp()
    where id = v_order_id;
    update public.commerce_order_items
    set payment_status = 'awaiting_payment',
        paid_at = null,
        storage_expires_at = null
    where order_id = v_order_id;
    if v_was_confirmed then
      insert into public.notifications (
        member_id,
        audience_role,
        kind,
        title,
        body,
        href
      ) values (
        v_member_id,
        'member',
        'payment_reversed',
        '입금 확인이 정정되었습니다.',
        '주문 상태와 남은 입금액을 다시 확인해 주세요.',
        '/account#orders'
      );
    end if;
    v_status := case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end;
  else
    update public.manual_transfer_orders
    set status = 'awaiting_manual_transfer',
        confirmed_at = null,
        confirmed_by = null,
        due_at = case
          when v_received = 0 and payment_deadline_held_at is not null
            then due_at_before_payment_hold
          else due_at
        end,
        payment_deadline_held_at = case
          when v_received = 0 then null
          else payment_deadline_held_at
        end,
        due_at_before_payment_hold = case
          when v_received = 0 then null
          else due_at_before_payment_hold
        end,
        offer_due_at_before_payment_hold = case
          when v_received = 0 then null
          else offer_due_at_before_payment_hold
        end,
        updated_at = clock_timestamp()
    where id = v_manual_order_id;
    v_status := case when v_received = 0 then 'awaiting_manual_transfer' else 'partially_paid' end;
  end if;

  return jsonb_build_object(
    'transfer_kind', v_entry.transfer_kind,
    'transfer_id', coalesce(v_transfer_id, v_manual_order_id),
    'received_amount', v_received,
    'remaining_amount', v_expected - v_received,
    'status', v_status
  );
end;
$$;

revoke all on function public.reverse_manual_transfer_payment(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.reverse_manual_transfer_payment(uuid, text)
to authenticated;

revoke all on function public.record_shipping_fee_payment(uuid, bigint, text, text)
from public, anon, authenticated, service_role;
drop function public.record_shipping_fee_payment(uuid, bigint, text, text);

create or replace function public.record_shipping_fee_payment(
  p_payment_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_idempotency_key, '')));
  v_payment public.shipping_fee_payments%rowtype;
  v_existing public.manual_transfer_payment_ledger%rowtype;
  v_received bigint;
  v_ledger_entry_count integer;
  v_credit_count integer;
  v_status text;
  v_ledger_id uuid;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  if p_payment_id is null then
    raise exception using errcode = '22023', message = '배송비 입금 대상을 선택해 주세요.';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000000 then
    raise exception using errcode = '22023', message = '입금액이 올바르지 않습니다.';
  end if;
  if p_expected_received_amount is null
    or p_expected_received_amount < 0
  then
    raise exception using errcode = '22023', message = '현재 누적 입금액이 올바르지 않습니다.';
  end if;
  if p_expected_ledger_entry_count is null
    or p_expected_ledger_entry_count < 0
  then
    raise exception using errcode = '22023', message = '현재 입금 원장 버전이 올바르지 않습니다.';
  end if;
  if nullif(btrim(coalesce(p_depositor_name, '')), '') is null
    or char_length(btrim(p_depositor_name)) > 80
  then
    raise exception using errcode = '22023', message = '입금자명을 입력해 주세요.';
  end if;
  if char_length(coalesce(p_memo, '')) > 500 then
    raise exception using errcode = '22023', message = '메모는 500자 이하로 입력해 주세요.';
  end if;
  if v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = '입금 요청 키가 올바르지 않습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-transfer-receipt:' || v_actor::text || ':' || v_key, 0)
  );

  select ledger.* into v_existing
  from public.manual_transfer_payment_ledger as ledger
  where ledger.recorded_by = v_actor
    and ledger.idempotency_key = v_key
    and ledger.entry_type = 'receipt';

  if found then
    if v_existing.transfer_kind is distinct from 'shipping'
      or v_existing.shipping_fee_payment_id is distinct from p_payment_id
      or v_existing.amount is distinct from p_amount
      or v_existing.depositor_name is distinct from btrim(p_depositor_name)
      or v_existing.memo is distinct from btrim(coalesce(p_memo, ''))
    then
      raise exception using
        errcode = '23505',
        message = '동일한 입금 요청 키를 다른 내용으로 재사용할 수 없습니다.';
    end if;
    select payments.* into v_payment
    from public.shipping_fee_payments as payments
    where payments.id = p_payment_id;
    if not found then
      raise exception using errcode = 'P0002', message = '배송비 입금 대기 건을 찾지 못했습니다.';
    end if;
    select
      coalesce(sum(
        case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
      ), 0)::bigint,
      count(*)::integer
    into v_received, v_ledger_entry_count
    from public.manual_transfer_payment_ledger as ledger
    where ledger.shipping_fee_payment_id = p_payment_id;
    v_status := case
      when v_received = v_payment.expected_amount then 'confirmed'
      when v_received > 0 then 'partially_paid'
      else v_payment.status
    end;
    return jsonb_build_object(
      'transfer_kind', 'shipping',
      'transfer_id', p_payment_id,
      'ledger_id', v_existing.id,
      'received_amount', v_received,
      'remaining_amount', v_payment.expected_amount - v_received,
      'ledger_entry_count', v_ledger_entry_count,
      'status', v_status,
      'idempotent_replay', true
    );
  end if;

  select payments.* into v_payment
  from public.shipping_fee_payments as payments
  where payments.id = p_payment_id
  for update;
  if not found or v_payment.status not in ('awaiting_transfer', 'partially_paid') then
    raise exception using errcode = '55000', message = '배송비 입금 대기 건을 찾지 못했습니다.';
  end if;

  select
    coalesce(sum(
      case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
    ), 0)::bigint,
    count(*)::integer
  into v_received, v_ledger_entry_count
  from public.manual_transfer_payment_ledger as ledger
  where ledger.shipping_fee_payment_id = p_payment_id;
  if v_received is distinct from p_expected_received_amount
    or v_ledger_entry_count is distinct from p_expected_ledger_entry_count
  then
    raise exception using
      errcode = 'PT409',
      message = '다른 운영자가 입금 원장을 변경했습니다. 목록을 새로고침한 뒤 다시 입력해 주세요.';
  end if;
  if v_received + p_amount > v_payment.expected_amount then
    raise exception using errcode = '22003', message = '배송비 잔액을 초과하는 입금액입니다.';
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind,
    shipping_fee_payment_id,
    entry_type,
    amount,
    depositor_name,
    memo,
    recorded_by,
    idempotency_key
  ) values (
    'shipping',
    p_payment_id,
    'receipt',
    p_amount,
    btrim(p_depositor_name),
    btrim(coalesce(p_memo, '')),
    v_actor,
    v_key
  ) returning id into v_ledger_id;
  v_received := v_received + p_amount;
  v_ledger_entry_count := v_ledger_entry_count + 1;

  if v_received = v_payment.expected_amount then
    if v_payment.shipping_request_id is null then
      update public.member_accounts
      set shipping_credit_count = shipping_credit_count + 1
      where member_id = v_payment.member_id
        and shipping_credit_count < 10000
      returning shipping_credit_count into v_credit_count;
      if v_credit_count is null then
        raise exception using errcode = '22003', message = '배송 이용권 한도에 도달했습니다.';
      end if;
      insert into public.shipping_credit_ledger (member_id, delta, reason, created_by)
      values (v_payment.member_id, 1, 'prepaid', v_actor);
    end if;
    update public.shipping_fee_payments
    set status = 'confirmed', confirmed_at = clock_timestamp(), confirmed_by = v_actor
    where id = p_payment_id;
    v_status := 'confirmed';
  else
    update public.shipping_fee_payments
    set status = 'partially_paid'
    where id = p_payment_id;
    v_status := 'partially_paid';
  end if;

  return jsonb_build_object(
    'transfer_kind', 'shipping',
    'transfer_id', p_payment_id,
    'ledger_id', v_ledger_id,
    'received_amount', v_received,
    'remaining_amount', v_payment.expected_amount - v_received,
    'ledger_entry_count', v_ledger_entry_count,
    'status', v_status,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.record_shipping_fee_payment(uuid, bigint, text, bigint, integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_shipping_fee_payment(uuid, bigint, text, bigint, integer, text, text)
to authenticated;

create or replace function public.reverse_shipping_fee_payment(
  p_ledger_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.manual_transfer_payment_ledger%rowtype;
  v_payment public.shipping_fee_payments%rowtype;
  v_payment_id uuid;
  v_received bigint;
  v_status text;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  if p_ledger_id is null then
    raise exception using errcode = '22023', message = '취소할 배송비 입금 기록을 선택해 주세요.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(btrim(p_reason)) > 500
  then
    raise exception using errcode = '22023', message = '취소 사유를 입력해 주세요.';
  end if;

  select ledger.shipping_fee_payment_id into v_payment_id
  from public.manual_transfer_payment_ledger as ledger
  where ledger.id = p_ledger_id
    and ledger.transfer_kind = 'shipping'
    and ledger.entry_type = 'receipt';
  if v_payment_id is null then
    raise exception using errcode = 'P0002', message = '취소할 배송비 입금 기록을 찾지 못했습니다.';
  end if;

  select payments.* into v_payment
  from public.shipping_fee_payments as payments
  where payments.id = v_payment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송비 입금 건을 찾지 못했습니다.';
  end if;

  select ledger.* into v_entry
  from public.manual_transfer_payment_ledger as ledger
  where ledger.id = p_ledger_id
    and ledger.transfer_kind = 'shipping'
    and ledger.entry_type = 'receipt'
    and ledger.shipping_fee_payment_id = v_payment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '취소할 배송비 입금 기록이 변경되었습니다.';
  end if;
  if exists (
    select 1
    from public.manual_transfer_payment_ledger as ledger
    where ledger.reversal_of = v_entry.id
  ) then
    raise exception using errcode = '55000', message = '이미 취소된 입금 기록입니다.';
  end if;
  if v_payment.shipping_request_id is not null then
    raise exception using
      errcode = '55000',
      message = '배송 요청에 연결된 배송비는 전용 취소 절차 없이 취소할 수 없습니다.';
  end if;

  if v_payment.status = 'confirmed' and v_payment.shipping_request_id is null then
    update public.member_accounts
    set shipping_credit_count = shipping_credit_count - 1
    where member_id = v_payment.member_id
      and shipping_credit_count > 0;
    if not found then
      raise exception using errcode = '55000', message = '이미 사용된 배송 이용권은 자동 취소할 수 없습니다.';
    end if;
    insert into public.shipping_credit_ledger (member_id, delta, reason, created_by)
    values (v_payment.member_id, -1, 'refund', v_actor);
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind,
    shipping_fee_payment_id,
    entry_type,
    amount,
    memo,
    reversal_of,
    recorded_by,
    idempotency_key
  ) values (
    'shipping',
    v_payment_id,
    'reversal',
    v_entry.amount,
    btrim(p_reason),
    v_entry.id,
    v_actor,
    null
  );

  select coalesce(sum(
    case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end
  ), 0)::bigint
  into v_received
  from public.manual_transfer_payment_ledger as ledger
  where ledger.shipping_fee_payment_id = v_payment_id;

  update public.shipping_fee_payments
  set status = case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end,
      confirmed_at = null,
      confirmed_by = null
  where id = v_payment_id;
  v_status := case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end;

  return jsonb_build_object(
    'transfer_kind', 'shipping',
    'transfer_id', v_payment_id,
    'received_amount', v_received,
    'remaining_amount', v_payment.expected_amount - v_received,
    'status', v_status
  );
end;
$$;

revoke all on function public.reverse_shipping_fee_payment(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.reverse_shipping_fee_payment(uuid, text)
to authenticated;

-- Restore only the pre-rollout active flag after every new function, trigger,
-- privilege, and constraint above has succeeded. Schedule, command, database,
-- username, identity, and an originally inactive state must remain untouched.
do $$
declare
  v_job_id bigint;
  v_job_count integer;
  v_snapshot_count integer;
  v_snapshot_job_id bigint;
  v_snapshot_job_name text;
  v_original_schedule text;
  v_original_command text;
  v_original_database text;
  v_original_username text;
  v_original_active boolean;
  v_current_schedule text;
  v_current_command text;
  v_current_database text;
  v_current_username text;
  v_current_active boolean;
  v_updated_count integer;
begin
  lock table cron.job in share row exclusive mode nowait;

  select count(*)::integer
  into v_snapshot_count
  from app_private.manual_transfer_cron_rollout_state as rollout
  where rollout.singleton
    and rollout.restored_at is null;

  if v_snapshot_count <> 1 then
    raise exception using
      errcode = '55000',
      message = '복원할 경매 cron 원상태 snapshot은 정확히 하나여야 합니다.';
  end if;

  select
    rollout.job_id,
    rollout.job_name,
    rollout.original_schedule,
    rollout.original_command,
    rollout.original_database,
    rollout.original_username,
    rollout.original_active
  into
    v_snapshot_job_id,
    v_snapshot_job_name,
    v_original_schedule,
    v_original_command,
    v_original_database,
    v_original_username,
    v_original_active
  from app_private.manual_transfer_cron_rollout_state as rollout
  where rollout.singleton
    and rollout.restored_at is null
  for update;

  select count(*)::integer
  into v_job_count
  from cron.job as jobs
  where jobs.jobname = v_snapshot_job_name;

  if v_job_count <> 1 then
    raise exception using
      errcode = '55000',
      message = '복원할 snapshot 경매 cron은 정확히 하나여야 합니다.';
  end if;

  select
    jobs.jobid,
    jobs.schedule,
    jobs.command,
    jobs.database,
    jobs.username,
    jobs.active
  into
    v_job_id,
    v_current_schedule,
    v_current_command,
    v_current_database,
    v_current_username,
    v_current_active
  from cron.job as jobs
  where jobs.jobname = v_snapshot_job_name
  for update;

  if v_job_id is distinct from v_snapshot_job_id
     or v_current_schedule is distinct from v_original_schedule
     or v_current_command is distinct from v_original_command
     or v_current_database is distinct from v_original_database
     or v_current_username is distinct from v_original_username
     or v_current_active is distinct from false then
    raise exception using
      errcode = '55000',
      message = '복원 직전 경매 cron 비활성 계약이 snapshot 원상태와 일치하지 않습니다.';
  end if;

  perform cron.alter_job(v_job_id, active => v_original_active);

  if not exists (
    select 1
    from cron.job as jobs
    where jobs.jobid = v_snapshot_job_id
      and jobs.jobname is not distinct from v_snapshot_job_name
      and jobs.schedule is not distinct from v_original_schedule
      and jobs.command is not distinct from v_original_command
      and jobs.database is not distinct from v_original_database
      and jobs.username is not distinct from v_original_username
      and jobs.active is not distinct from v_original_active
  ) then
    raise exception using
      errcode = '55000',
      message = '경매 cron 복원 후 계약이 저장된 원상태와 일치하지 않습니다.';
  end if;

  update app_private.manual_transfer_cron_rollout_state
  set restored_at = clock_timestamp()
  where singleton
    and restored_at is null;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using
      errcode = '55000',
      message = '경매 cron 원상태 snapshot 복원 완료를 기록하지 못했습니다.';
  end if;
end;
$$;

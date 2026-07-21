begin;

-- Phase 1 of the manual-transfer hardening rollout. Commit the external
-- confirmation revocation before changing the receipt contract so no new
-- authenticated client can bypass the ledger during the maintenance window.
-- Every settlement writer must be quiesced and drained before this file runs.
-- That includes the operator/owner APIs and the postgres-owned
-- process-auction-purchase-offers pg_cron job. Migration 20260721134000 installs
-- the ledger-state fence and deactivates that job in a separately committed
-- phase. Confirm the scheduler has observed that commit and all active calls
-- have drained before continuing. A statement that passed EXECUTE checks before
-- commit can otherwise remain queued behind these table locks.

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ninety-nine:manual-transfer-cron-rollout', 0)
  );

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
  where jobs.jobname = v_snapshot_job_name;

  if v_job_id is distinct from v_snapshot_job_id
     or v_current_schedule is distinct from v_original_schedule
     or v_current_command is distinct from v_original_command
     or v_current_database is distinct from v_original_database
     or v_current_username is distinct from v_original_username
     or v_current_active is distinct from false then
    raise exception using
      errcode = '55000',
      message = '경매 cron 비활성 상태 또는 snapshot 계약이 원상태와 일치하지 않습니다.';
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

-- Do not enter maintenance with unresolved historical money. NOWAIT makes a
-- busy store retry this phase instead of mixing the audit with live writers.
lock table
  public.products,
  public.auction_purchase_offers,
  public.manual_transfer_orders,
  public.commerce_orders,
  public.commerce_order_items,
  public.commerce_order_transfers,
  public.shipping_fee_payments,
  public.manual_transfer_payment_ledger
in exclusive mode nowait;

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

revoke all on function public.confirm_commerce_order_transfer(uuid)
from public, anon, authenticated, service_role;

revoke all on function public.confirm_manual_transfer(uuid, timestamptz)
from public, anon, authenticated, service_role;

-- Fail closed between phases. If the contract migration cannot obtain its
-- NOWAIT locks or its integrity audit fails, no legacy mutation can create new
-- non-idempotent or status-inconsistent ledger rows before the operator fixes
-- the data and retries phase 2.
revoke all on function public.record_manual_transfer_payment(text, uuid, bigint, text, text)
from public, anon, authenticated, service_role;

revoke all on function public.reverse_manual_transfer_payment(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.record_shipping_fee_payment(uuid, bigint, text, text)
from public, anon, authenticated, service_role;

revoke all on function public.reverse_shipping_fee_payment(uuid, text)
from public, anon, authenticated, service_role;

commit;

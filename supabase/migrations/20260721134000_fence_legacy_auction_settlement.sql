-- Phase 0 of the manual-transfer hardening rollout. Every application writer
-- must already be stopped before this migration. The postgres-owned auction
-- scheduler cannot be drained by revoking API EXECUTE privileges, so install
-- the signed-ledger state fence first and then disable the existing job without
-- deleting its identity or run history.

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
      (new.status = 'awaiting_manual_transfer' and v_received between 0 and new.expected_amount - 1)
      or (new.status = 'confirmed' and v_received = new.expected_amount)
      or (new.status = 'cancelled_unpaid' and v_received = 0);
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

-- Preserve the exact scheduler contract so the final phase can restore the
-- pre-rollout state instead of silently canonicalizing or reactivating it.
create table app_private.manual_transfer_cron_rollout_state (
  singleton boolean primary key default true,
  job_id bigint not null,
  job_name text not null,
  original_schedule text not null,
  original_command text not null,
  original_database text not null,
  original_username text not null,
  original_active boolean not null,
  captured_at timestamptz not null default clock_timestamp(),
  restored_at timestamptz,
  constraint manual_transfer_cron_rollout_state_singleton_check
    check (singleton)
);

revoke all on table app_private.manual_transfer_cron_rollout_state
from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
  v_job_count integer;
  v_job_name text;
  v_original_schedule text;
  v_original_command text;
  v_original_database text;
  v_original_username text;
  v_original_active boolean;
begin
  if coalesce(current_setting('cron.log_run', true), 'off') <> 'on' then
    raise exception using
      errcode = '55000',
      message = '경매 cron 드레인 검증을 위해 cron.log_run=on이 필요합니다.';
  end if;

  lock table cron.job in share row exclusive mode nowait;

  select count(*)::integer, min(jobs.jobid)
  into v_job_count, v_job_id
  from cron.job as jobs
  where jobs.jobname = 'process-auction-purchase-offers';

  if v_job_count <> 1 or v_job_id is null then
    raise exception using
      errcode = '55000',
      message = '중지할 process-auction-purchase-offers cron은 정확히 하나여야 합니다.';
  end if;

  select
    jobs.jobname,
    jobs.schedule,
    jobs.command,
    jobs.database,
    jobs.username,
    jobs.active
  into
    v_job_name,
    v_original_schedule,
    v_original_command,
    v_original_database,
    v_original_username,
    v_original_active
  from cron.job as jobs
  where jobs.jobid = v_job_id
    and jobs.jobname = 'process-auction-purchase-offers'
  for update;

  if v_job_name is null then
    raise exception using
      errcode = '55000',
      message = '중지할 process-auction-purchase-offers cron 계약을 잠글 수 없습니다.';
  end if;

  insert into app_private.manual_transfer_cron_rollout_state (
    singleton,
    job_id,
    job_name,
    original_schedule,
    original_command,
    original_database,
    original_username,
    original_active
  ) values (
    true,
    v_job_id,
    v_job_name,
    v_original_schedule,
    v_original_command,
    v_original_database,
    v_original_username,
    v_original_active
  );

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
      message = '실행 중인 경매 구매 제안 정산 작업이 끝난 뒤 0단계를 다시 시도해 주세요.';
  end if;

  perform cron.alter_job(v_job_id, active => false);

  if not exists (
    select 1
    from cron.job as jobs
    where jobs.jobid = v_job_id
      and jobs.jobname is not distinct from v_job_name
      and jobs.schedule is not distinct from v_original_schedule
      and jobs.command is not distinct from v_original_command
      and jobs.database is not distinct from v_original_database
      and jobs.username is not distinct from v_original_username
      and jobs.active is false
  ) then
    raise exception using
      errcode = '55000',
      message = '경매 cron 비활성화 후 저장된 계약과 현재 계약이 일치하지 않습니다.';
  end if;
end;
$$;

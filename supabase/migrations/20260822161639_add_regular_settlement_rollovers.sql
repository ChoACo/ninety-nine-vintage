begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

alter table public.store_service_subscriptions
  add column if not exists unpaid_fee_balance bigint not null default 0 check (unpaid_fee_balance >= 0),
  add column if not exists fee_rollover_count integer not null default 0 check (fee_rollover_count >= 0),
  add column if not exists overdue_notice_sent_at timestamptz;

alter table public.store_settlement_batches
  add column if not exists cycle_code text,
  add column if not exists monthly_store_fee bigint not null default 0 check (monthly_store_fee >= 0),
  add column if not exists carried_over_fee bigint not null default 0 check (carried_over_fee >= 0),
  add column if not exists remaining_unpaid_fee bigint not null default 0 check (remaining_unpaid_fee >= 0),
  add column if not exists fee_rollover_count integer not null default 0 check (fee_rollover_count >= 0),
  add column if not exists overdue_notice_sent_at timestamptz;

alter table public.store_settlement_batches drop constraint if exists store_settlement_batches_status_check;
alter table public.store_settlement_batches
  add constraint store_settlement_batches_status_check check (status in ('draft','paid','no_payout','cancelled'));

create table if not exists public.store_fee_applications (
  id uuid primary key default gen_random_uuid(),
  settlement_batch_id uuid not null references public.store_settlement_batches(id) on delete restrict,
  settlement_entry_id uuid not null references public.store_settlement_entries(id) on delete restrict,
  applied_amount bigint not null check (applied_amount > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (settlement_batch_id, settlement_entry_id)
);

alter table public.store_fee_applications enable row level security;
alter table public.store_fee_applications force row level security;
revoke all on table public.store_fee_applications from public, anon, authenticated;
grant select on table public.store_fee_applications to service_role;

create or replace function app_private.is_service_role()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((auth.jwt()->>'role') = 'service_role', false)
$$;
revoke all on function app_private.is_service_role() from public,anon,authenticated;
grant execute on function app_private.is_service_role() to service_role;

create or replace function public.create_owner_settlement_batches(p_settlement_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_cutoff timestamptz;
  v_created integer := 0;
  v_store record;
  v_fee record;
  v_batch_id uuid;
  v_sales bigint;
  v_commission bigint;
  v_other bigint;
  v_net_before_fee bigint;
  v_fee_due bigint;
  v_monthly_fee bigint;
  v_carried bigint;
  v_deduct bigint;
  v_remaining bigint;
  v_payout bigint;
  v_rollovers integer;
  v_apply bigint;
  v_notice_at timestamptz;
  v_cycle text;
begin
  if not public.is_owner() and not app_private.is_service_role() then
    raise exception using errcode='42501',message='소유자 권한이 필요합니다.';
  end if;
  if extract(isodow from p_settlement_date) not in (1,4) then
    raise exception using errcode='22023',message='정산일은 월요일 또는 목요일이어야 합니다.';
  end if;
  v_cutoff := (p_settlement_date::text || ' 18:00:00 Asia/Seoul')::timestamptz;
  if clock_timestamp() < v_cutoff then
    raise exception using errcode='22023',message='정산일 오후 6시 이후에 생성할 수 있습니다.';
  end if;
  v_cycle := to_char(p_settlement_date,'YYYY-MM') || '-W' || ceil(extract(day from p_settlement_date)/7.0)::integer ||
    case when extract(isodow from p_settlement_date)=1 then '-MON' else '-THU' end;

  for v_store in
    select stores.id, subscriptions.monthly_fee, subscriptions.unpaid_fee_balance,
      subscriptions.fee_rollover_count, subscriptions.overdue_notice_sent_at,
      accounts.bank_name, accounts.account_holder, accounts.account_number_masked, accounts.version account_version
    from public.stores stores
    join public.store_service_subscriptions subscriptions on subscriptions.store_id=stores.id
    left join public.store_payout_accounts accounts on accounts.store_id=stores.id and accounts.status='approved'
    where stores.is_active
    order by stores.id for update of subscriptions
  loop
    if exists(select 1 from public.store_settlement_batches where store_id=v_store.id and settlement_date=p_settlement_date) then
      continue;
    end if;

    select
      coalesce(sum(case when entry_kind in ('item_sale','shipping_fee') then amount else 0 end),0)::bigint,
      coalesce(sum(case when entry_kind='commission' then -amount else 0 end),0)::bigint,
      coalesce(sum(case when entry_kind not in ('item_sale','shipping_fee','commission','subscription_fee') then amount else 0 end),0)::bigint
    into v_sales,v_commission,v_other
    from public.store_settlement_entries
    where store_id=v_store.id and settlement_batch_id is null and eligible_at<=v_cutoff;

    select coalesce(sum(greatest(0, -fees.amount-coalesce(applied.total,0))),0)::bigint
    into v_fee_due
    from public.store_settlement_entries fees
    left join lateral (select sum(applications.applied_amount)::bigint total
      from public.store_fee_applications applications where applications.settlement_entry_id=fees.id) applied on true
    where fees.store_id=v_store.id and fees.entry_kind='subscription_fee' and fees.eligible_at<=v_cutoff;

    select coalesce(sum(greatest(0, -fees.amount-coalesce(applied.total,0))),0)::bigint
    into v_monthly_fee
    from public.store_settlement_entries fees
    left join lateral (select sum(applications.applied_amount)::bigint total
      from public.store_fee_applications applications where applications.settlement_entry_id=fees.id) applied on true
    where fees.store_id=v_store.id and fees.entry_kind='subscription_fee' and fees.eligible_at<=v_cutoff
      and timezone('Asia/Seoul',fees.created_at)::date >= date_trunc('month',p_settlement_date)::date;

    v_carried := greatest(0,v_fee_due-v_monthly_fee);
    v_net_before_fee := v_sales-v_commission+v_other;
    v_deduct := least(greatest(v_net_before_fee,0),v_fee_due);
    v_remaining := greatest(0,v_fee_due-v_deduct);
    v_payout := greatest(0,v_net_before_fee-v_deduct);
    v_rollovers := case when v_remaining=0 then 0 else v_store.fee_rollover_count+1 end;
    v_notice_at := case when v_remaining>0 and v_rollovers>=4 then coalesce(v_store.overdue_notice_sent_at,clock_timestamp()) else null end;

    if v_sales=0 and v_commission=0 and v_other=0 and v_fee_due=0 then continue; end if;
    if v_payout>0 and v_store.bank_name is null then continue; end if;

    insert into public.store_settlement_batches(store_id,settlement_date,cutoff_at,gross_amount,
      commission_amount,subscription_deduction,payout_amount,status,payout_account_snapshot,
      cycle_code,monthly_store_fee,carried_over_fee,remaining_unpaid_fee,fee_rollover_count,overdue_notice_sent_at)
    values(v_store.id,p_settlement_date,v_cutoff,v_sales,v_commission,v_deduct,v_payout,
      case when v_payout>0 then 'draft' else 'no_payout' end,
      case when v_store.bank_name is null then '{}'::jsonb else jsonb_build_object('bankName',v_store.bank_name,
        'accountHolder',v_store.account_holder,'accountNumberMasked',v_store.account_number_masked,
        'accountVersion',v_store.account_version) end,
      v_cycle,v_monthly_fee,v_carried,v_remaining,v_rollovers,v_notice_at)
    returning id into v_batch_id;

    update public.store_settlement_entries set settlement_batch_id=v_batch_id
    where store_id=v_store.id and settlement_batch_id is null and eligible_at<=v_cutoff and entry_kind<>'subscription_fee';

    v_apply := v_deduct;
    for v_fee in
      select fees.id, greatest(0,-fees.amount-coalesce(applied.total,0))::bigint remaining
      from public.store_settlement_entries fees
      left join lateral (select sum(applications.applied_amount)::bigint total from public.store_fee_applications applications
        where applications.settlement_entry_id=fees.id) applied on true
      where fees.store_id=v_store.id and fees.entry_kind='subscription_fee' and fees.eligible_at<=v_cutoff
        and greatest(0,-fees.amount-coalesce(applied.total,0))>0 order by fees.eligible_at,fees.id
    loop
      exit when v_apply<=0;
      insert into public.store_fee_applications(settlement_batch_id,settlement_entry_id,applied_amount)
      values(v_batch_id,v_fee.id,least(v_apply,v_fee.remaining));
      v_apply := v_apply-least(v_apply,v_fee.remaining);
    end loop;

    update public.store_service_subscriptions set unpaid_fee_balance=v_remaining,fee_rollover_count=v_rollovers,
      overdue_notice_sent_at=v_notice_at,updated_at=clock_timestamp(),version=version+1 where store_id=v_store.id;

    if v_remaining>0 and v_rollovers>=4 and v_store.overdue_notice_sent_at is null then
      insert into public.notifications(member_id,audience_role,kind,title,body,href)
      select memberships.user_id,'operator','OWNER_SETTLEMENT_REQUEST','입점비 별도 납부가 필요합니다.',
        format('누적 미납 입점비 %s원이 %s회 연속 이월되었습니다. 소유자 안내에 따라 별도 납부해 주세요.',v_remaining,v_rollovers),
        '/admin/operator/platform'
      from public.store_memberships memberships where memberships.store_id=v_store.id
        and memberships.status='active' and memberships.membership_role in ('operator','employee');
    end if;
    v_created := v_created+1;
  end loop;
  return jsonb_build_object('settlementDate',p_settlement_date,'cutoffAt',v_cutoff,'createdBatchCount',v_created);
end; $$;
revoke all on function public.create_owner_settlement_batches(date) from public,anon,authenticated,service_role;
grant execute on function public.create_owner_settlement_batches(date) to authenticated,service_role;

create or replace function public.complete_owner_settlement_batch(
  p_batch_id uuid,p_transfer_reference text,p_expected_version bigint,p_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_batch public.store_settlement_batches%rowtype;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if nullif(btrim(p_transfer_reference),'') is null or char_length(p_transfer_reference)>160
    or nullif(btrim(p_reason),'') is null or char_length(p_reason)>500 then
    raise exception using errcode='22023',message='송금 참조번호와 완료 사유를 확인해 주세요.';
  end if;
  update public.store_settlement_batches set status='paid',transfer_reference=btrim(p_transfer_reference),
    paid_by=auth.uid(),paid_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  where id=p_batch_id and status='draft' and version=p_expected_version returning * into v_batch;
  if not found then raise exception using errcode='40001',message='정산 배치 상태가 변경되었습니다.'; end if;
  insert into public.notifications(member_id,audience_role,kind,title,body,href)
  select memberships.user_id,'operator','OWNER_SETTLEMENT_REQUEST','센터 정산 송금이 완료되었습니다.',
    format('%s원 정산 송금이 완료되었습니다.',v_batch.payout_amount),'/admin/operator/platform'
  from public.store_memberships memberships where memberships.store_id=v_batch.store_id
    and memberships.status='active' and memberships.membership_role in ('operator','employee');
  insert into public.store_payout_account_access_events(store_id,actor_user_id,reason)
  values(v_batch.store_id,auth.uid(),left(format('%s / batch=%s / amount=%s / ref=%s',btrim(p_reason),
    v_batch.id,v_batch.payout_amount,btrim(p_transfer_reference)),200));
  return jsonb_build_object('id',v_batch.id,'status',v_batch.status,'paidAt',v_batch.paid_at,'version',v_batch.version);
end; $$;
revoke all on function public.complete_owner_settlement_batch(uuid,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_owner_settlement_batch(uuid,text,bigint,text) to authenticated;

create or replace function public.get_owner_payout_desk()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_owner() then jsonb_build_object(
    'pendingCount',count(*) filter(where batches.status='draft'),
    'pendingAmount',coalesce(sum(batches.payout_amount) filter(where batches.status='draft'),0),
    'batches',coalesce(jsonb_agg(jsonb_build_object(
      'id',batches.id,'storeId',stores.id,'storeName',stores.name,'settlementDate',batches.settlement_date,
      'cycleCode',batches.cycle_code,'grossSales',batches.gross_amount,'platformFee',batches.commission_amount,
      'monthlyStoreFee',batches.monthly_store_fee,'carriedOverFee',batches.carried_over_fee,
      'deductedFee',batches.subscription_deduction,'remainingUnpaidFee',batches.remaining_unpaid_fee,
      'payoutAmount',batches.payout_amount,'feeRolloverCount',batches.fee_rollover_count,
      'overdueNoticeSentAt',batches.overdue_notice_sent_at,'status',batches.status,'paidAt',batches.paid_at,
      'version',batches.version,'bankName',batches.payout_account_snapshot->>'bankName',
      'accountHolder',batches.payout_account_snapshot->>'accountHolder',
      'accountNumberMasked',batches.payout_account_snapshot->>'accountNumberMasked')
      order by batches.settlement_date desc,batches.created_at desc),'[]'::jsonb)
  ) else null::jsonb end
  from public.store_settlement_batches batches join public.stores stores on stores.id=batches.store_id;
$$;
revoke all on function public.get_owner_payout_desk() from public,anon,authenticated,service_role;
grant execute on function public.get_owner_payout_desk() to authenticated;

commit;

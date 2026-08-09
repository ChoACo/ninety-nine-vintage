begin;

create or replace function app_private.store_commission_rate(p_store_id uuid,p_at timestamptz)
returns numeric language sql stable security definer set search_path='' as $$
  select case when exists(
    select 1 from public.store_service_subscriptions subscriptions
    where subscriptions.store_id=p_store_id and subscriptions.plan_code='pro'
      and subscriptions.status='active' and subscriptions.started_at<=p_at
  ) then 0.035::numeric else 0.05::numeric end
$$;
revoke all on function app_private.store_commission_rate(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.accrue_store_subscription_fees(p_as_of timestamptz default clock_timestamp())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_subscription public.store_service_subscriptions%rowtype; v_due timestamptz;
  v_next_month date; v_next_date date; v_count integer:=0;
begin
  if auth.role()<>'service_role' and session_user<>'postgres'
  then raise exception using errcode='42501',message='이용료 부과 권한이 없습니다.'; end if;
  for v_subscription in select * from public.store_service_subscriptions
    where monthly_fee>0 and status in ('active','delinquent') and next_billing_at<=p_as_of for update
  loop
    v_due:=v_subscription.next_billing_at;
    while v_due<=p_as_of loop
      insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_key,metadata)
      values(v_subscription.store_id,'subscription_fee',-v_subscription.monthly_fee,v_due,'subscription',
        'subscription:'||v_subscription.store_id::text||':'||(v_due at time zone 'Asia/Seoul')::date::text,
        jsonb_build_object('planCode',v_subscription.plan_code,'billingPeriodStart',v_due,'billingPeriodEnd',
          v_due+interval '1 month','firstStartedAt',v_subscription.started_at))
      on conflict(source_key) do nothing;
      v_count:=v_count+1;
      v_next_month:=(date_trunc('month',(v_due at time zone 'Asia/Seoul')::date)+interval '1 month')::date;
      v_next_date:=v_next_month+least(v_subscription.billing_anchor_day,
        extract(day from (v_next_month+interval '1 month' - interval '1 day'))::integer)-1;
      v_due:=(v_next_date::text||' 00:00:00 Asia/Seoul')::timestamptz;
    end loop;
    update public.store_service_subscriptions set next_billing_at=v_due,status='delinquent',
      grace_until=coalesce(grace_until,p_as_of+interval '7 days'),version=version+1,updated_at=clock_timestamp()
    where store_id=v_subscription.store_id;
  end loop;
  return jsonb_build_object('accruedCount',v_count,'asOf',p_as_of);
end; $$;
revoke all on function public.accrue_store_subscription_fees(timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.accrue_store_subscription_fees(timestamptz) to service_role;

do $$
declare v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job_id from cron.job where jobname='accrue-store-subscription-fees' limit 1;
    if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
    perform cron.schedule('accrue-store-subscription-fees','10 15 * * *',
      $job$select public.accrue_store_subscription_fees(clock_timestamp());$job$);
  end if;
end $$;

create or replace function app_private.project_shipped_store_settlement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='shipped' and old.status is distinct from 'shipped' then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select items.origin_store_id,'item_sale',inventory.paid_amount,new.shipped_at,'inventory_item',inventory.id,
      'item-sale:'||inventory.id::text,jsonb_build_object('shipmentId',new.id,'productId',inventory.product_id)
    from public.inventory_shipment_items items join public.customer_inventory_items inventory on inventory.id=items.inventory_item_id
    where items.shipment_id=new.id and items.line_status in ('packed','shipped','ready') on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select items.origin_store_id,'commission',-ceil(inventory.paid_amount*r.rate)::bigint,new.shipped_at,
      'inventory_item',inventory.id,'item-commission:'||inventory.id::text,
      jsonb_build_object('rate',r.rate,'planSnapshot',case when r.rate=0.035 then 'pro' else 'standard' end,
        'rounding','ceil','shipmentId',new.id)
    from public.inventory_shipment_items items join public.customer_inventory_items inventory on inventory.id=items.inventory_item_id
    cross join lateral (select app_private.store_commission_rate(items.origin_store_id,new.shipped_at) rate) r
    where items.shipment_id=new.id and items.line_status in ('packed','shipped','ready') on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select distinct allocations.billing_store_id,'shipping_fee',allocations.amount,new.shipped_at,'shipping_allocation',allocations.id,
      'shipping-fee:'||allocations.id::text,allocations.policy_snapshot||jsonb_build_object('shipmentId',new.id)
    from public.inventory_shipment_items shipment_items join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
      and (allocations.charge_mode='per_group' or allocations.origin_store_id=shipment_items.origin_store_id)
    where shipment_items.shipment_id=new.id on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select distinct allocations.billing_store_id,'commission',-ceil(allocations.amount*r.rate)::bigint,new.shipped_at,
      'shipping_allocation',allocations.id,'shipping-commission:'||allocations.id::text,
      jsonb_build_object('rate',r.rate,'planSnapshot',case when r.rate=0.035 then 'pro' else 'standard' end,
        'rounding','ceil','shipmentId',new.id)
    from public.inventory_shipment_items shipment_items join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
      and (allocations.charge_mode='per_group' or allocations.origin_store_id=shipment_items.origin_store_id)
    cross join lateral (select app_private.store_commission_rate(allocations.billing_store_id,new.shipped_at) rate) r
    where shipment_items.shipment_id=new.id on conflict(source_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function app_private.project_shipped_store_settlement() from public,anon,authenticated,service_role;

create or replace function app_private.project_store_refund_settlement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.entry_kind='item_refund' and new.origin_store_id is not null then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    values(new.origin_store_id,'item_refund',new.amount,new.occurred_at,'store_financial_entry',new.id,
      'item-refund:'||new.id::text,new.metadata) on conflict(source_key) do nothing;
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select new.origin_store_id,'commission',-original.amount,new.occurred_at,'store_financial_entry',new.id,
      'item-refund-commission:'||new.id::text,
      new.metadata||jsonb_build_object('reversal',true,'originalCommissionEntryId',original.id,
        'rate',original.metadata->'rate','planSnapshot',original.metadata->'planSnapshot')
    from public.store_settlement_entries original
    where original.entry_kind='commission' and original.source_kind='inventory_item'
      and original.source_id=new.inventory_item_id and original.amount<0
    order by original.created_at limit 1 on conflict(source_key) do nothing;
  elsif new.entry_kind='shipping_fee_refund' and new.inventory_shipment_id is not null then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select distinct allocations.billing_store_id,'shipping_fee_refund',-allocations.amount,new.occurred_at,
      'shipping_allocation',allocations.id,'shipping-refund:'||new.id::text||':'||allocations.id::text,
      allocations.policy_snapshot||jsonb_build_object('financialEntryId',new.id)
    from public.inventory_shipment_items shipment_items join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
    where shipment_items.shipment_id=new.inventory_shipment_id on conflict(source_key) do nothing;
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select original.store_id,'commission',-original.amount,new.occurred_at,'shipping_allocation',original.source_id,
      'shipping-refund-commission:'||new.id::text||':'||original.source_id::text,
      jsonb_build_object('financialEntryId',new.id,'reversal',true,'originalCommissionEntryId',original.id,
        'rate',original.metadata->'rate','planSnapshot',original.metadata->'planSnapshot')
    from public.store_settlement_entries original
    where original.entry_kind='commission' and original.source_kind='shipping_allocation' and original.amount<0
      and exists(
        select 1 from public.inventory_shipment_items shipment_items
        join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
        join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
        join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
          and allocations.id=original.source_id
        where shipment_items.shipment_id=new.inventory_shipment_id
      )
    on conflict(source_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function app_private.project_store_refund_settlement() from public,anon,authenticated,service_role;

create or replace function public.create_owner_settlement_batches(p_settlement_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_cutoff timestamptz; v_created integer:=0;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if extract(isodow from p_settlement_date) not in (1,4)
  then raise exception using errcode='22023',message='정산일은 월요일 또는 목요일이어야 합니다.'; end if;
  v_cutoff:=(p_settlement_date::text||' 09:00:00 Asia/Seoul')::timestamptz;
  if clock_timestamp()<v_cutoff then raise exception using errcode='22023',message='정산일 오전 9시 이후에 생성할 수 있습니다.'; end if;
  with candidates as (
    select entries.store_id,sum(entries.amount)::bigint net,
      sum(case when entries.entry_kind='commission' then -entries.amount else 0 end)::bigint commission,
      sum(case when entries.entry_kind='subscription_fee' then -entries.amount else 0 end)::bigint subscription
    from public.store_settlement_entries entries
    where entries.settlement_batch_id is null and entries.eligible_at<=v_cutoff
    group by entries.store_id having sum(entries.amount)>0
  ), inserted as (
    insert into public.store_settlement_batches(store_id,settlement_date,cutoff_at,gross_amount,
      commission_amount,subscription_deduction,payout_amount,payout_account_snapshot)
    select candidates.store_id,p_settlement_date,v_cutoff,
      candidates.net+candidates.commission+candidates.subscription,candidates.commission,candidates.subscription,
      (ceil(candidates.net/10.0)*10)::bigint,jsonb_build_object('bankName',accounts.bank_name,
        'accountHolder',accounts.account_holder,'accountNumberMasked',accounts.account_number_masked,
        'accountVersion',accounts.version)
    from candidates join public.store_payout_accounts accounts on accounts.store_id=candidates.store_id and accounts.status='approved'
    on conflict(store_id,settlement_date) do nothing returning id,store_id
  )
  update public.store_settlement_entries entries set settlement_batch_id=inserted.id
  from inserted where entries.store_id=inserted.store_id and entries.settlement_batch_id is null and entries.eligible_at<=v_cutoff;
  get diagnostics v_created=row_count;
  return jsonb_build_object('settlementDate',p_settlement_date,'cutoffAt',v_cutoff,'assignedEntryCount',v_created);
end; $$;
revoke all on function public.create_owner_settlement_batches(date) from public,anon,authenticated,service_role;
grant execute on function public.create_owner_settlement_batches(date) to authenticated;

create or replace function public.get_operator_store_platform_management()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('stores',coalesce(jsonb_agg(jsonb_build_object(
    'id',stores.id,'name',stores.name,'planCode',coalesce(subscriptions.plan_code,'standard'),
    'requestedPlanCode',subscriptions.requested_plan_code,'subscriptionStatus',coalesce(subscriptions.status,'active'),
    'monthlyFee',coalesce(subscriptions.monthly_fee,30000),'subscriptionVersion',coalesce(subscriptions.version,0),
    'aiUsed',coalesce(usage.ai_request_count,0),'productsCreated',coalesce(usage.product_create_count,0),
    'totalSettlementSales',coalesce(metrics.total_sales,0),'weeklySales',coalesce(metrics.weekly_sales,0),
    'nextSettlementEstimate',greatest(0,(ceil(coalesce(metrics.open_net,0)/10.0)*10)::bigint),
    'paidTotal',coalesce(metrics.paid_total,0),
    'payoutAccount',case when accounts.store_id is null then null else jsonb_build_object(
      'bankName',accounts.bank_name,'accountHolder',accounts.account_holder,
      'accountNumberMasked',accounts.account_number_masked,'status',accounts.status,'version',accounts.version) end,
    'settlements',coalesce((select jsonb_agg(jsonb_build_object('id',batches.id,'settlementDate',batches.settlement_date,
      'grossAmount',batches.gross_amount,'commissionAmount',batches.commission_amount,
      'subscriptionDeduction',batches.subscription_deduction,'payoutAmount',batches.payout_amount,
      'status',batches.status,'paidAt',batches.paid_at) order by batches.settlement_date desc)
      from public.store_settlement_batches batches where batches.store_id=stores.id),'[]'::jsonb),
    'settlementEntries',coalesce((select jsonb_agg(jsonb_build_object('id',entry_rows.id,'kind',entry_rows.entry_kind,
      'amount',entry_rows.amount,'eligibleAt',entry_rows.eligible_at,'batchId',entry_rows.settlement_batch_id)
      order by entry_rows.eligible_at desc,entry_rows.id desc)
      from (select entries.* from public.store_settlement_entries entries where entries.store_id=stores.id
        order by entries.eligible_at desc,entries.id desc limit 100) entry_rows),'[]'::jsonb)
  ) order by stores.name),'[]'::jsonb))
  from public.stores stores
  join public.store_memberships memberships on memberships.store_id=stores.id and memberships.user_id=auth.uid()
    and memberships.status='active'
  left join public.store_service_subscriptions subscriptions on subscriptions.store_id=stores.id
  left join public.store_daily_usage usage on usage.store_id=stores.id
    and usage.usage_date=timezone('Asia/Seoul',statement_timestamp())::date
  left join public.store_payout_accounts accounts on accounts.store_id=stores.id
  left join lateral (select
    sum(case when entries.entry_kind in ('item_sale','shipping_fee') then entries.amount else 0 end)::bigint total_sales,
    sum(case when entries.entry_kind in ('item_sale','shipping_fee') and
      entries.eligible_at>=date_trunc('week',timezone('Asia/Seoul',statement_timestamp())) at time zone 'Asia/Seoul'
      then entries.amount else 0 end)::bigint weekly_sales,
    sum(case when entries.settlement_batch_id is null then entries.amount else 0 end)::bigint open_net,
    (select sum(batches.payout_amount)::bigint from public.store_settlement_batches batches
      where batches.store_id=stores.id and batches.status='paid') paid_total
    from public.store_settlement_entries entries where entries.store_id=stores.id) metrics on true
  where public.access_role_for_user(auth.uid()) in ('owner','operator');
$$;
revoke all on function public.get_operator_store_platform_management() from public,anon,authenticated,service_role;
grant execute on function public.get_operator_store_platform_management() to authenticated;

commit;

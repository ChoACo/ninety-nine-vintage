-- Shipping-fee transfers use the same append-only receipt ledger as orders.
-- A standalone fee purchase grants one shipping credit only after full payment.

alter table public.shipping_fee_payments
  drop constraint if exists shipping_fee_payments_status_check;
alter table public.shipping_fee_payments
  add constraint shipping_fee_payments_status_check
  check (status in ('awaiting_transfer', 'partially_paid', 'confirmed', 'cancelled'));

alter table public.manual_transfer_payment_ledger
  add column if not exists shipping_fee_payment_id uuid
    references public.shipping_fee_payments (id) on delete restrict;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.manual_transfer_payment_ledger'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%transfer_kind%'
  loop
    execute format('alter table public.manual_transfer_payment_ledger drop constraint %I', v_constraint_name);
  end loop;
end;
$$;

alter table public.manual_transfer_payment_ledger
  add constraint manual_transfer_payment_ledger_transfer_kind_check
  check (transfer_kind in ('auction', 'commerce', 'shipping'));
alter table public.manual_transfer_payment_ledger
  add constraint manual_transfer_payment_ledger_transfer_reference_check
  check (
    (transfer_kind = 'auction' and manual_transfer_order_id is not null and commerce_order_transfer_id is null and shipping_fee_payment_id is null)
    or (transfer_kind = 'commerce' and commerce_order_transfer_id is not null and manual_transfer_order_id is null and shipping_fee_payment_id is null)
    or (transfer_kind = 'shipping' and shipping_fee_payment_id is not null and manual_transfer_order_id is null and commerce_order_transfer_id is null)
  );
create index if not exists manual_transfer_payment_ledger_shipping_idx
  on public.manual_transfer_payment_ledger (shipping_fee_payment_id, created_at);

drop policy if exists "Members read their manual transfer ledger" on public.manual_transfer_payment_ledger;
create policy "Members read their manual transfer ledger"
  on public.manual_transfer_payment_ledger for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.manual_transfer_orders as auction_orders
      where auction_orders.id = manual_transfer_order_id and auction_orders.buyer_id = auth.uid()
    )
    or exists (
      select 1 from public.commerce_order_transfers as commerce_transfers
      where commerce_transfers.id = commerce_order_transfer_id and commerce_transfers.member_id = auth.uid()
    )
    or exists (
      select 1 from public.shipping_fee_payments as shipping_payments
      where shipping_payments.id = shipping_fee_payment_id and shipping_payments.member_id = auth.uid()
    )
  );

create or replace function public.record_shipping_fee_payment(
  p_payment_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.shipping_fee_payments%rowtype;
  v_received bigint;
  v_credit_count integer;
  v_status text;
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
  if nullif(btrim(coalesce(p_depositor_name, '')), '') is null or char_length(btrim(p_depositor_name)) > 80 then
    raise exception using errcode = '22023', message = '입금자명을 입력해 주세요.';
  end if;
  if char_length(coalesce(p_memo, '')) > 500 then
    raise exception using errcode = '22023', message = '메모는 500자 이하로 입력해 주세요.';
  end if;

  select * into v_payment from public.shipping_fee_payments where id = p_payment_id for update;
  if not found or v_payment.status = 'cancelled' then
    raise exception using errcode = 'P0002', message = '배송비 입금 대기 건을 찾지 못했습니다.';
  end if;

  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)
    into v_received
  from public.manual_transfer_payment_ledger
  where shipping_fee_payment_id = p_payment_id;
  if v_received + p_amount > v_payment.expected_amount then
    raise exception using errcode = '22003', message = '배송비 잔액을 초과하는 입금액입니다.';
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind, shipping_fee_payment_id, entry_type, amount, depositor_name, memo, recorded_by
  ) values (
    'shipping', p_payment_id, 'receipt', p_amount, btrim(p_depositor_name), btrim(coalesce(p_memo, '')), v_actor
  );
  v_received := v_received + p_amount;

  if v_received = v_payment.expected_amount then
    if v_payment.shipping_request_id is null then
      update public.member_accounts
      set shipping_credit_count = shipping_credit_count + 1
      where member_id = v_payment.member_id and shipping_credit_count < 10000
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
    update public.shipping_fee_payments set status = 'partially_paid' where id = p_payment_id;
    v_status := 'partially_paid';
  end if;

  return jsonb_build_object(
    'transfer_kind', 'shipping', 'transfer_id', p_payment_id,
    'received_amount', v_received, 'remaining_amount', v_payment.expected_amount - v_received,
    'status', v_status
  );
end;
$$;

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
  v_received bigint;
  v_status text;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = '취소 사유를 입력해 주세요.';
  end if;
  select * into v_entry from public.manual_transfer_payment_ledger where id = p_ledger_id for update;
  if not found or v_entry.transfer_kind <> 'shipping' or v_entry.entry_type <> 'receipt' then
    raise exception using errcode = 'P0002', message = '취소할 배송비 입금 기록을 찾지 못했습니다.';
  end if;
  if exists (select 1 from public.manual_transfer_payment_ledger where reversal_of = v_entry.id) then
    raise exception using errcode = '55000', message = '이미 취소된 입금 기록입니다.';
  end if;
  select * into v_payment from public.shipping_fee_payments where id = v_entry.shipping_fee_payment_id for update;
  if v_payment.shipping_request_id is not null and exists (
    select 1 from public.shipping_requests
    where id = v_payment.shipping_request_id and status in ('shipped', 'delivered')
  ) then
    raise exception using errcode = '55000', message = '배송이 시작된 배송비는 자동 취소할 수 없습니다.';
  end if;

  if v_payment.status = 'confirmed' and v_payment.shipping_request_id is null then
    update public.member_accounts
    set shipping_credit_count = shipping_credit_count - 1
    where member_id = v_payment.member_id and shipping_credit_count > 0;
    if not found then
      raise exception using errcode = '55000', message = '이미 사용된 배송 이용권은 자동 취소할 수 없습니다.';
    end if;
    insert into public.shipping_credit_ledger (member_id, delta, reason, created_by)
    values (v_payment.member_id, -1, 'refund', v_actor);
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind, shipping_fee_payment_id, entry_type, amount, memo, reversal_of, recorded_by
  ) values (
    'shipping', v_entry.shipping_fee_payment_id, 'reversal', v_entry.amount, btrim(p_reason), v_entry.id, v_actor
  );
  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)
    into v_received
  from public.manual_transfer_payment_ledger
  where shipping_fee_payment_id = v_entry.shipping_fee_payment_id;
  update public.shipping_fee_payments
  set status = case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end,
      confirmed_at = null,
      confirmed_by = null
  where id = v_entry.shipping_fee_payment_id;
  v_status := case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end;
  return jsonb_build_object(
    'transfer_kind', 'shipping', 'transfer_id', v_entry.shipping_fee_payment_id,
    'received_amount', v_received, 'remaining_amount', v_payment.expected_amount - v_received,
    'status', v_status
  );
end;
$$;

revoke all on function public.record_shipping_fee_payment(uuid, bigint, text, text) from public, anon;
grant execute on function public.record_shipping_fee_payment(uuid, bigint, text, text) to authenticated;
revoke all on function public.reverse_shipping_fee_payment(uuid, text) from public, anon;
grant execute on function public.reverse_shipping_fee_payment(uuid, text) to authenticated;

-- Operator-entered manual-transfer receipts are append-only.  A receipt is
-- never overwritten; a correction appends an equal reversal entry instead.

alter table public.commerce_order_transfers
  drop constraint if exists commerce_order_transfers_status_check;
alter table public.commerce_order_transfers
  add constraint commerce_order_transfers_status_check
  check (status in ('awaiting_transfer', 'partially_paid', 'confirmed', 'cancelled'));

create table if not exists public.manual_transfer_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  transfer_kind text not null check (transfer_kind in ('auction', 'commerce')),
  manual_transfer_order_id uuid references public.manual_transfer_orders (id) on delete restrict,
  commerce_order_transfer_id uuid references public.commerce_order_transfers (id) on delete restrict,
  entry_type text not null check (entry_type in ('receipt', 'reversal')),
  amount bigint not null check (amount > 0 and amount <= 1000000000),
  depositor_name text check (depositor_name is null or char_length(btrim(depositor_name)) between 1 and 80),
  memo text not null default '' check (char_length(memo) <= 500),
  reversal_of uuid references public.manual_transfer_payment_ledger (id) on delete restrict,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (transfer_kind = 'auction' and manual_transfer_order_id is not null and commerce_order_transfer_id is null)
    or (transfer_kind = 'commerce' and commerce_order_transfer_id is not null and manual_transfer_order_id is null)
  ),
  check (
    (entry_type = 'receipt' and reversal_of is null and depositor_name is not null)
    or (entry_type = 'reversal' and reversal_of is not null and depositor_name is null)
  )
);

create unique index if not exists manual_transfer_payment_ledger_one_reversal_idx
  on public.manual_transfer_payment_ledger (reversal_of)
  where entry_type = 'reversal';
create index if not exists manual_transfer_payment_ledger_auction_idx
  on public.manual_transfer_payment_ledger (manual_transfer_order_id, created_at);
create index if not exists manual_transfer_payment_ledger_commerce_idx
  on public.manual_transfer_payment_ledger (commerce_order_transfer_id, created_at);

alter table public.manual_transfer_payment_ledger enable row level security;
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
  );

create or replace function public.record_manual_transfer_payment(
  p_transfer_kind text,
  p_transfer_id uuid,
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
  v_expected bigint;
  v_received bigint;
  v_order_id uuid;
  v_product_id uuid;
  v_status text;
  v_transfer public.commerce_order_transfers%rowtype;
  v_auction public.manual_transfer_orders%rowtype;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_transfer_kind not in ('auction', 'commerce') or p_transfer_id is null then
    raise exception using errcode = '22023', message = '입금 대상을 선택해 주세요.';
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

  if p_transfer_kind = 'commerce' then
    select * into v_transfer
    from public.commerce_order_transfers
    where id = p_transfer_id
    for update;
    if not found or v_transfer.status = 'cancelled' then
      raise exception using errcode = 'P0002', message = '입금 대기 주문을 찾지 못했습니다.';
    end if;
    v_expected := v_transfer.expected_amount;
    v_order_id := v_transfer.order_id;
    if not public.is_owner() and (
      not exists (select 1 from public.commerce_order_items where order_id = v_order_id)
      or exists (
        select 1
        from public.commerce_order_items as items
        left join public.stores as stores on stores.id = items.store_id
        where items.order_id = v_order_id
          and stores.operator_id is distinct from v_actor
      )
    ) then
      raise exception using errcode = '42501', message = '이 주문의 입금을 처리할 권한이 없습니다.';
    end if;
  else
    select * into v_auction
    from public.manual_transfer_orders
    where id = p_transfer_id
    for update;
    if not found or v_auction.status = 'cancelled' then
      raise exception using errcode = 'P0002', message = '낙찰 입금 대기 건을 찾지 못했습니다.';
    end if;
    v_expected := v_auction.expected_amount;
    v_product_id := v_auction.product_id;
    if not public.is_owner() and not exists (
      select 1 from public.products as products
      join public.stores as stores on stores.id = products.store_id
      where products.id = v_product_id and stores.operator_id = v_actor
    ) then
      raise exception using errcode = '42501', message = '이 낙찰 건의 입금을 처리할 권한이 없습니다.';
    end if;
  end if;

  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)
  into v_received
  from public.manual_transfer_payment_ledger
  where (p_transfer_kind = 'commerce' and commerce_order_transfer_id = p_transfer_id)
     or (p_transfer_kind = 'auction' and manual_transfer_order_id = p_transfer_id);
  if v_received + p_amount > v_expected then
    raise exception using errcode = '22003', message = '주문 잔액을 초과하는 입금액입니다.';
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind, manual_transfer_order_id, commerce_order_transfer_id,
    entry_type, amount, depositor_name, memo, recorded_by
  ) values (
    p_transfer_kind,
    case when p_transfer_kind = 'auction' then p_transfer_id end,
    case when p_transfer_kind = 'commerce' then p_transfer_id end,
    'receipt', p_amount, btrim(p_depositor_name), btrim(coalesce(p_memo, '')), v_actor
  );
  v_received := v_received + p_amount;

  if p_transfer_kind = 'commerce' then
    if v_received = v_expected then
      perform public.confirm_commerce_order_transfer(v_order_id);
      v_status := 'confirmed';
    else
      update public.commerce_order_transfers set status = 'partially_paid' where id = p_transfer_id;
      update public.commerce_orders set status = 'partially_paid', updated_at = clock_timestamp() where id = v_order_id;
      v_status := 'partially_paid';
    end if;
  else
    if v_received = v_expected then
      perform public.confirm_manual_transfer(p_transfer_id, v_auction.updated_at);
      v_status := 'confirmed';
    else
      v_status := 'partially_paid';
    end if;
  end if;

  return jsonb_build_object(
    'transfer_kind', p_transfer_kind,
    'transfer_id', p_transfer_id,
    'received_amount', v_received,
    'remaining_amount', v_expected - v_received,
    'status', v_status
  );
end;
$$;

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
  v_product_id uuid;
  v_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = '취소 사유를 입력해 주세요.';
  end if;

  select * into v_entry from public.manual_transfer_payment_ledger where id = p_ledger_id for update;
  if not found or v_entry.entry_type <> 'receipt' then
    raise exception using errcode = 'P0002', message = '취소할 입금 기록을 찾지 못했습니다.';
  end if;
  if exists (select 1 from public.manual_transfer_payment_ledger where reversal_of = v_entry.id) then
    raise exception using errcode = '55000', message = '이미 취소된 입금 기록입니다.';
  end if;

  if v_entry.transfer_kind = 'commerce' then
    select expected_amount, order_id into v_expected, v_order_id
    from public.commerce_order_transfers where id = v_entry.commerce_order_transfer_id for update;
    if not public.is_owner() and exists (
      select 1 from public.commerce_order_items as items
      left join public.stores as stores on stores.id = items.store_id
      where items.order_id = v_order_id and stores.operator_id is distinct from v_actor
    ) then
      raise exception using errcode = '42501', message = '이 주문의 입금을 처리할 권한이 없습니다.';
    end if;
    if exists (
      select 1 from public.shipping_request_items as shipping_items
      join public.commerce_order_items as items on items.product_id = shipping_items.product_id
      where items.order_id = v_order_id
    ) then
      raise exception using errcode = '55000', message = '배송 접수된 주문은 자동 취소할 수 없습니다.';
    end if;
  else
    select expected_amount, product_id into v_expected, v_product_id
    from public.manual_transfer_orders where id = v_entry.manual_transfer_order_id for update;
    if not public.is_owner() and not exists (
      select 1 from public.products as products
      join public.stores as stores on stores.id = products.store_id
      where products.id = v_product_id and stores.operator_id = v_actor
    ) then
      raise exception using errcode = '42501', message = '이 낙찰 건의 입금을 처리할 권한이 없습니다.';
    end if;
    if exists (select 1 from public.shipping_request_items where product_id = v_product_id) then
      raise exception using errcode = '55000', message = '배송 접수된 낙찰 건은 자동 취소할 수 없습니다.';
    end if;
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind, manual_transfer_order_id, commerce_order_transfer_id,
    entry_type, amount, memo, reversal_of, recorded_by
  ) values (
    v_entry.transfer_kind, v_entry.manual_transfer_order_id, v_entry.commerce_order_transfer_id,
    'reversal', v_entry.amount, btrim(p_reason), v_entry.id, v_actor
  );

  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)
  into v_received
  from public.manual_transfer_payment_ledger
  where (v_entry.transfer_kind = 'commerce' and commerce_order_transfer_id = v_entry.commerce_order_transfer_id)
     or (v_entry.transfer_kind = 'auction' and manual_transfer_order_id = v_entry.manual_transfer_order_id);

  if v_entry.transfer_kind = 'commerce' then
    update public.commerce_order_transfers
    set status = case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end,
        confirmed_at = null,
        confirmed_by = null
    where id = v_entry.commerce_order_transfer_id;
    update public.commerce_orders
    set status = case when v_received = 0 then 'awaiting_payment' else 'partially_paid' end,
        updated_at = clock_timestamp()
    where id = v_order_id;
    update public.commerce_order_items
    set payment_status = 'awaiting_payment', paid_at = null, storage_expires_at = null
    where order_id = v_order_id;
    v_status := case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end;
  else
    update public.manual_transfer_orders
    set status = 'awaiting_manual_transfer', confirmed_at = null, confirmed_by = null
    where id = v_entry.manual_transfer_order_id;
    v_status := case when v_received = 0 then 'awaiting_manual_transfer' else 'partially_paid' end;
  end if;

  return jsonb_build_object(
    'transfer_kind', v_entry.transfer_kind,
    'transfer_id', coalesce(v_entry.commerce_order_transfer_id, v_entry.manual_transfer_order_id),
    'received_amount', v_received,
    'remaining_amount', v_expected - v_received,
    'status', v_status
  );
end;
$$;

revoke all on function public.record_manual_transfer_payment(text, uuid, bigint, text, text) from public, anon;
grant execute on function public.record_manual_transfer_payment(text, uuid, bigint, text, text) to authenticated;
revoke all on function public.reverse_manual_transfer_payment(uuid, text) from public, anon;
grant execute on function public.reverse_manual_transfer_payment(uuid, text) to authenticated;

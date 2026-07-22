begin;

-- Reversals must be bound to the target shown to the operator. A persisted,
-- actor-scoped UUID v4 makes an ambiguous response safely replayable, while
-- balance/count observations reject a stale first attempt before any mutation.
lock table public.manual_transfer_payment_ledger
in access exclusive mode nowait;

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
    or (
      entry_type = 'reversal'
      and (
        idempotency_key is null
        or idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
  );

-- NULL identifies reversals created before this contract. New reversals always
-- carry a UUID v4, so retries by the same actor can return the original result.
create unique index if not exists manual_transfer_payment_ledger_reversal_idempotency_idx
  on public.manual_transfer_payment_ledger (recorded_by, idempotency_key)
  where entry_type = 'reversal' and idempotency_key is not null;

create or replace function public.reverse_manual_transfer_payment(
  p_expected_transfer_kind text,
  p_expected_transfer_id uuid,
  p_ledger_id uuid,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_idempotency_key, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_entry public.manual_transfer_payment_ledger%rowtype;
  v_existing public.manual_transfer_payment_ledger%rowtype;
  v_prior_reversal public.manual_transfer_payment_ledger%rowtype;
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_auction public.manual_transfer_orders%rowtype;
  v_expected bigint;
  v_received bigint;
  v_ledger_entry_count integer;
  v_order_id uuid;
  v_member_id uuid;
  v_product_id uuid;
  v_purchase_offer_id uuid;
  v_status text;
  v_reversal_id uuid;
  v_is_replay boolean := false;
  v_was_confirmed boolean := false;
  v_settings public.payment_runtime_settings%rowtype;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_expected_transfer_kind is null
    or p_expected_transfer_kind not in ('auction', 'commerce')
    or p_expected_transfer_id is null
    or p_ledger_id is null
  then
    raise exception using errcode = '22023', message = '취소할 입금 대상을 선택해 주세요.';
  end if;
  if p_expected_received_amount is null or p_expected_received_amount < 0 then
    raise exception using errcode = '22023', message = '현재 누적 입금액이 올바르지 않습니다.';
  end if;
  if p_expected_ledger_entry_count is null or p_expected_ledger_entry_count < 1 then
    raise exception using errcode = '22023', message = '현재 입금 원장 버전이 올바르지 않습니다.';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = '취소 사유를 입력해 주세요.';
  end if;
  if v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = '취소 요청 키가 올바르지 않습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-transfer-reversal:' || v_actor::text || ':' || v_key, 0)
  );

  select ledger.* into v_existing
  from public.manual_transfer_payment_ledger as ledger
  where ledger.recorded_by = v_actor
    and ledger.idempotency_key = v_key
    and ledger.entry_type = 'reversal';

  if found then
    if v_existing.transfer_kind is distinct from p_expected_transfer_kind
      or v_existing.reversal_of is distinct from p_ledger_id
      or v_existing.memo is distinct from v_reason
      or (
        p_expected_transfer_kind = 'commerce'
        and v_existing.commerce_order_transfer_id is distinct from p_expected_transfer_id
      )
      or (
        p_expected_transfer_kind = 'auction'
        and v_existing.manual_transfer_order_id is distinct from p_expected_transfer_id
      )
    then
      raise exception using
        errcode = '23505',
        message = '동일한 취소 요청 키를 다른 내용으로 재사용할 수 없습니다.';
    end if;
    v_is_replay := true;
    v_reversal_id := v_existing.id;
  else
    select settings.* into v_settings
    from public.payment_runtime_settings as settings
    where settings.singleton
    for update;
    if not found or v_settings.active_mode <> 'manual_transfer' then
      raise exception using
        errcode = 'PT409',
        message = '수동 계좌이체 모드에서만 입금 원장을 취소할 수 있습니다.';
    end if;
  end if;

  -- This probe is deliberately non-locking. It rejects a URL/ledger mismatch
  -- before parent selection; the exact relationship is checked again under the
  -- canonical parent and receipt locks below.
  select ledger.* into v_entry
  from public.manual_transfer_payment_ledger as ledger
  where ledger.id = p_ledger_id
    and ledger.entry_type = 'receipt'
    and ledger.transfer_kind = p_expected_transfer_kind
    and (
      (
        p_expected_transfer_kind = 'commerce'
        and ledger.commerce_order_transfer_id = p_expected_transfer_id
      )
      or (
        p_expected_transfer_kind = 'auction'
        and ledger.manual_transfer_order_id = p_expected_transfer_id
      )
    );
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 입금 대상의 취소 기록을 찾지 못했습니다.';
  end if;

  if p_expected_transfer_kind = 'commerce' then
    select transfers.order_id into v_order_id
    from public.commerce_order_transfers as transfers
    where transfers.id = p_expected_transfer_id;
    if v_order_id is null then
      raise exception using errcode = 'P0002', message = '입금 주문을 찾지 못했습니다.';
    end if;

    select orders.* into v_order
    from public.commerce_orders as orders
    where orders.id = v_order_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '주문을 찾지 못했습니다.';
    end if;
    v_member_id := v_order.member_id;

    perform products.id
    from public.products as products
    join public.commerce_order_items as items on items.product_id = products.id
    where items.order_id = v_order_id
    order by products.id
    for update of products;
    if not found then
      raise exception using errcode = '23514', message = '주문 상품이 없어 입금 취소를 처리할 수 없습니다.';
    end if;

    select transfers.* into v_transfer
    from public.commerce_order_transfers as transfers
    where transfers.id = p_expected_transfer_id
      and transfers.order_id = v_order_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '입금 요청을 찾지 못했습니다.';
    end if;
    v_expected := v_transfer.expected_amount;
    v_was_confirmed := v_transfer.status = 'confirmed';

    select ledger.* into v_entry
    from public.manual_transfer_payment_ledger as ledger
    where ledger.id = p_ledger_id
      and ledger.entry_type = 'receipt'
      and ledger.transfer_kind = 'commerce'
      and ledger.commerce_order_transfer_id = p_expected_transfer_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '취소할 입금 기록이 변경되었습니다.';
    end if;

    if not v_is_replay and exists (
      select 1
      from public.shipping_request_items as shipping_items
      join public.commerce_order_items as items
        on items.product_id = shipping_items.product_id
      where items.order_id = v_order_id
    ) then
      raise exception using errcode = '55000', message = '배송 접수된 주문은 자동 취소할 수 없습니다.';
    end if;
  else
    select orders.product_id into v_product_id
    from public.manual_transfer_orders as orders
    where orders.id = p_expected_transfer_id;
    if v_product_id is null then
      raise exception using errcode = 'P0002', message = '낙찰 입금 주문을 찾지 못했습니다.';
    end if;

    perform 1
    from public.products as products
    where products.id = v_product_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '경매 상품을 찾지 못했습니다.';
    end if;

    select orders.* into v_auction
    from public.manual_transfer_orders as orders
    where orders.id = p_expected_transfer_id
      and orders.product_id = v_product_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '낙찰 입금 주문을 찾지 못했습니다.';
    end if;
    v_expected := v_auction.expected_amount;
    v_purchase_offer_id := v_auction.purchase_offer_id;
    v_member_id := v_auction.buyer_id;

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
    if not v_is_replay and v_purchase_offer_id is not null then
      raise exception using
        errcode = '55000',
        message = '구매 제안에 연결된 낙찰 입금은 전용 재정산 절차 없이 취소할 수 없습니다.';
    end if;

    select ledger.* into v_entry
    from public.manual_transfer_payment_ledger as ledger
    where ledger.id = p_ledger_id
      and ledger.entry_type = 'receipt'
      and ledger.transfer_kind = 'auction'
      and ledger.manual_transfer_order_id = p_expected_transfer_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '취소할 입금 기록이 변경되었습니다.';
    end if;

    if not v_is_replay and exists (
      select 1
      from public.shipping_request_items
      where product_id = v_product_id
    ) then
      raise exception using errcode = '55000', message = '배송 접수된 낙찰 건은 자동 취소할 수 없습니다.';
    end if;
  end if;

  select ledger.* into v_prior_reversal
  from public.manual_transfer_payment_ledger as ledger
  where ledger.reversal_of = v_entry.id;
  if found then
    if not v_is_replay or v_prior_reversal.id is distinct from v_reversal_id then
      raise exception using errcode = '55000', message = '이미 취소된 입금 기록입니다.';
    end if;
    if v_prior_reversal.amount is distinct from v_entry.amount
      or v_prior_reversal.transfer_kind is distinct from v_entry.transfer_kind
    then
      raise exception using errcode = '23514', message = '기존 취소 원장의 무결성을 확인할 수 없습니다.';
    end if;
  elsif v_is_replay then
    raise exception using errcode = '23514', message = '기존 취소 원장의 원본 연결을 확인할 수 없습니다.';
  end if;

  select
    coalesce(sum(
      case
        when ledger.entry_type = 'receipt' then ledger.amount
        when ledger.entry_type = 'reversal' then -ledger.amount
        else 0
      end
    ), 0)::bigint,
    count(*)::integer
  into v_received, v_ledger_entry_count
  from public.manual_transfer_payment_ledger as ledger
  where (
    p_expected_transfer_kind = 'commerce'
    and ledger.commerce_order_transfer_id = p_expected_transfer_id
  ) or (
    p_expected_transfer_kind = 'auction'
    and ledger.manual_transfer_order_id = p_expected_transfer_id
  );

  if v_received < 0 or v_received > v_expected then
    raise exception using errcode = '23514', message = '입금 원장 누적액의 무결성을 확인할 수 없습니다.';
  end if;

  if not v_is_replay then
    if v_received is distinct from p_expected_received_amount
      or v_ledger_entry_count is distinct from p_expected_ledger_entry_count
    then
      raise exception using
        errcode = 'PT409',
        message = '다른 운영자가 입금 원장을 변경했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.';
    end if;
    if v_received < v_entry.amount then
      raise exception using errcode = '23514', message = '취소 후 입금 누적액이 음수가 될 수 없습니다.';
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
      p_expected_transfer_kind,
      case when p_expected_transfer_kind = 'auction' then p_expected_transfer_id end,
      case when p_expected_transfer_kind = 'commerce' then p_expected_transfer_id end,
      'reversal',
      v_entry.amount,
      v_reason,
      v_entry.id,
      v_actor,
      v_key
    ) returning id into v_reversal_id;
    v_received := v_received - v_entry.amount;
    v_ledger_entry_count := v_ledger_entry_count + 1;

    if p_expected_transfer_kind = 'commerce' then
      update public.commerce_order_transfers
      set status = case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end,
          confirmed_at = null,
          confirmed_by = null
      where id = p_expected_transfer_id;
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
      where id = p_expected_transfer_id;
      v_status := case when v_received = 0 then 'awaiting_manual_transfer' else 'partially_paid' end;
    end if;
  elsif p_expected_transfer_kind = 'commerce' then
    v_status := case
      when v_received = v_expected then 'confirmed'
      when v_received > 0 then 'partially_paid'
      else v_transfer.status
    end;
  else
    v_status := case
      when v_received = v_expected then 'confirmed'
      when v_received > 0 then 'partially_paid'
      else v_auction.status
    end;
  end if;

  return jsonb_build_object(
    'transfer_kind', p_expected_transfer_kind,
    'transfer_id', p_expected_transfer_id,
    'ledger_id', v_reversal_id,
    'reversal_of', v_entry.id,
    'received_amount', v_received,
    'remaining_amount', v_expected - v_received,
    'ledger_entry_count', v_ledger_entry_count,
    'status', v_status,
    'idempotent_replay', v_is_replay
  );
end;
$$;

create or replace function public.reverse_shipping_fee_payment(
  p_expected_transfer_kind text,
  p_expected_transfer_id uuid,
  p_ledger_id uuid,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_idempotency_key, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_entry public.manual_transfer_payment_ledger%rowtype;
  v_existing public.manual_transfer_payment_ledger%rowtype;
  v_prior_reversal public.manual_transfer_payment_ledger%rowtype;
  v_payment public.shipping_fee_payments%rowtype;
  v_received bigint;
  v_ledger_entry_count integer;
  v_credit_count integer;
  v_status text;
  v_reversal_id uuid;
  v_is_replay boolean := false;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  if p_expected_transfer_kind is distinct from 'shipping'
    or p_expected_transfer_id is null
    or p_ledger_id is null
  then
    raise exception using errcode = '22023', message = '취소할 배송비 입금 대상을 선택해 주세요.';
  end if;
  if p_expected_received_amount is null or p_expected_received_amount < 0 then
    raise exception using errcode = '22023', message = '현재 누적 입금액이 올바르지 않습니다.';
  end if;
  if p_expected_ledger_entry_count is null or p_expected_ledger_entry_count < 1 then
    raise exception using errcode = '22023', message = '현재 입금 원장 버전이 올바르지 않습니다.';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = '취소 사유를 입력해 주세요.';
  end if;
  if v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = '취소 요청 키가 올바르지 않습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-transfer-reversal:' || v_actor::text || ':' || v_key, 0)
  );

  select ledger.* into v_existing
  from public.manual_transfer_payment_ledger as ledger
  where ledger.recorded_by = v_actor
    and ledger.idempotency_key = v_key
    and ledger.entry_type = 'reversal';
  if found then
    if v_existing.transfer_kind is distinct from 'shipping'
      or v_existing.shipping_fee_payment_id is distinct from p_expected_transfer_id
      or v_existing.reversal_of is distinct from p_ledger_id
      or v_existing.memo is distinct from v_reason
    then
      raise exception using
        errcode = '23505',
        message = '동일한 취소 요청 키를 다른 내용으로 재사용할 수 없습니다.';
    end if;
    v_is_replay := true;
    v_reversal_id := v_existing.id;
  end if;

  select ledger.* into v_entry
  from public.manual_transfer_payment_ledger as ledger
  where ledger.id = p_ledger_id
    and ledger.entry_type = 'receipt'
    and ledger.transfer_kind = 'shipping'
    and ledger.shipping_fee_payment_id = p_expected_transfer_id;
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송비 입금 대상의 취소 기록을 찾지 못했습니다.';
  end if;

  select payments.* into v_payment
  from public.shipping_fee_payments as payments
  where payments.id = p_expected_transfer_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송비 입금 건을 찾지 못했습니다.';
  end if;

  select ledger.* into v_entry
  from public.manual_transfer_payment_ledger as ledger
  where ledger.id = p_ledger_id
    and ledger.entry_type = 'receipt'
    and ledger.transfer_kind = 'shipping'
    and ledger.shipping_fee_payment_id = p_expected_transfer_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '취소할 배송비 입금 기록이 변경되었습니다.';
  end if;

  select ledger.* into v_prior_reversal
  from public.manual_transfer_payment_ledger as ledger
  where ledger.reversal_of = v_entry.id;
  if found then
    if not v_is_replay or v_prior_reversal.id is distinct from v_reversal_id then
      raise exception using errcode = '55000', message = '이미 취소된 입금 기록입니다.';
    end if;
    if v_prior_reversal.amount is distinct from v_entry.amount
      or v_prior_reversal.transfer_kind is distinct from 'shipping'
    then
      raise exception using errcode = '23514', message = '기존 취소 원장의 무결성을 확인할 수 없습니다.';
    end if;
  elsif v_is_replay then
    raise exception using errcode = '23514', message = '기존 취소 원장의 원본 연결을 확인할 수 없습니다.';
  end if;

  if not v_is_replay and v_payment.shipping_request_id is not null then
    raise exception using
      errcode = '55000',
      message = '배송 요청에 연결된 배송비는 전용 취소 절차 없이 취소할 수 없습니다.';
  end if;

  select
    coalesce(sum(
      case
        when ledger.entry_type = 'receipt' then ledger.amount
        when ledger.entry_type = 'reversal' then -ledger.amount
        else 0
      end
    ), 0)::bigint,
    count(*)::integer
  into v_received, v_ledger_entry_count
  from public.manual_transfer_payment_ledger as ledger
  where ledger.shipping_fee_payment_id = p_expected_transfer_id;

  if v_received < 0 or v_received > v_payment.expected_amount then
    raise exception using errcode = '23514', message = '배송비 입금 원장 누적액의 무결성을 확인할 수 없습니다.';
  end if;

  if not v_is_replay then
    if v_received is distinct from p_expected_received_amount
      or v_ledger_entry_count is distinct from p_expected_ledger_entry_count
    then
      raise exception using
        errcode = 'PT409',
        message = '다른 운영자가 입금 원장을 변경했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.';
    end if;
    if v_received < v_entry.amount then
      raise exception using errcode = '23514', message = '취소 후 배송비 입금 누적액이 음수가 될 수 없습니다.';
    end if;

    if v_payment.status = 'confirmed' then
      update public.member_accounts
      set shipping_credit_count = shipping_credit_count - 1
      where member_id = v_payment.member_id
        and shipping_credit_count > 0
      returning shipping_credit_count into v_credit_count;
      if v_credit_count is null then
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
      p_expected_transfer_id,
      'reversal',
      v_entry.amount,
      v_reason,
      v_entry.id,
      v_actor,
      v_key
    ) returning id into v_reversal_id;
    v_received := v_received - v_entry.amount;
    v_ledger_entry_count := v_ledger_entry_count + 1;

    update public.shipping_fee_payments
    set status = case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end,
        confirmed_at = null,
        confirmed_by = null
    where id = p_expected_transfer_id;
    v_status := case when v_received = 0 then 'awaiting_transfer' else 'partially_paid' end;
  else
    v_status := case
      when v_received = v_payment.expected_amount then 'confirmed'
      when v_received > 0 then 'partially_paid'
      else v_payment.status
    end;
  end if;

  return jsonb_build_object(
    'transfer_kind', 'shipping',
    'transfer_id', p_expected_transfer_id,
    'ledger_id', v_reversal_id,
    'reversal_of', v_entry.id,
    'received_amount', v_received,
    'remaining_amount', v_payment.expected_amount - v_received,
    'ledger_entry_count', v_ledger_entry_count,
    'status', v_status,
    'idempotent_replay', v_is_replay
  );
end;
$$;

revoke all on function public.reverse_manual_transfer_payment(text, uuid, uuid, bigint, integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.reverse_manual_transfer_payment(text, uuid, uuid, bigint, integer, text, text)
to authenticated;

revoke all on function public.reverse_shipping_fee_payment(text, uuid, uuid, bigint, integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.reverse_shipping_fee_payment(text, uuid, uuid, bigint, integer, text, text)
to authenticated;

-- The old ledger-only contract cannot prove which URL target the operator saw.
-- Remove it atomically with the new bound functions so legacy callers fail
-- closed instead of mutating a different payment target.
revoke all on function public.reverse_manual_transfer_payment(uuid, text)
from public, anon, authenticated, service_role;
drop function public.reverse_manual_transfer_payment(uuid, text);

revoke all on function public.reverse_shipping_fee_payment(uuid, text)
from public, anon, authenticated, service_role;
drop function public.reverse_shipping_fee_payment(uuid, text);

commit;

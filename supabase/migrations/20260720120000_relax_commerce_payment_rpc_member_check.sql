-- API routes already authenticate an active member account. Keep these RPCs
-- usable for that session even when an older JWT lacks Kakao provider claims.
-- No payment secret is exposed by the status RPC, and transfer creation still
-- requires ownership of the requested commerce order.

create or replace function public.get_commerce_payment_status()
returns table (
  active_mode text,
  configured boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  return query
  select
    settings.active_mode,
    settings.active_mode = 'manual_transfer'
      and settings.bank_name is not null
      and settings.account_number is not null
  from public.payment_runtime_settings as settings
  where settings.singleton;
end;
$$;

create or replace function public.create_commerce_order_transfer(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_settings public.payment_runtime_settings%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_order_id is null then
    raise exception using errcode = '22023', message = '주문을 확인해 주세요.';
  end if;

  select * into v_order
  from public.commerce_orders
  where id = p_order_id and member_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '주문을 찾을 수 없습니다.';
  end if;
  if v_order.status <> 'awaiting_payment' then
    raise exception using errcode = '55000', message = '입금 대기 중인 주문이 아닙니다.';
  end if;

  select * into v_transfer
  from public.commerce_order_transfers
  where order_id = p_order_id
  for update;
  if found then
    if v_transfer.status = 'cancelled' then
      raise exception using errcode = '55000', message = '취소된 입금 요청입니다.';
    end if;
    return to_jsonb(v_transfer);
  end if;

  select * into v_settings
  from public.payment_runtime_settings
  where singleton;
  if not found
    or v_settings.active_mode <> 'manual_transfer'
    or v_settings.bank_name is null
    or v_settings.account_number is null
  then
    raise exception using errcode = 'P0001', message = '운영자가 입금 계좌를 설정한 후 주문할 수 있습니다.';
  end if;

  insert into public.commerce_order_transfers (
    order_id,
    member_id,
    expected_amount,
    bank_name_snapshot,
    account_number_snapshot
  ) values (
    v_order.id,
    v_user_id,
    v_order.total,
    v_settings.bank_name,
    v_settings.account_number
  )
  returning * into v_transfer;

  return to_jsonb(v_transfer);
end;
$$;

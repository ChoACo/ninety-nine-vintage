-- Permit the isolated production test member to exercise the same checkout
-- transaction as a normal member without creating a third-party Kakao identity.
-- Every non-test member still requires Kakao and, when enabled, a completed
-- verified Kakao profile.

create or replace function public.create_commerce_order_transfer(
  p_order_id uuid
)
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
  v_requires_verified_profile boolean;
  v_is_production_test_member boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_order_id is null then
    raise exception using errcode = '22023', message = '주문을 확인해 주세요.';
  end if;

  v_is_production_test_member := public.is_owner_hidden_test_member(v_user_id)
    and public.access_role_for_user(v_user_id) = 'member';

  select coalesce(requirements.enforce_verified_profile, false)
  into v_requires_verified_profile
  from public.kakao_profile_requirements as requirements
  where requirements.singleton;
  v_requires_verified_profile := coalesce(v_requires_verified_profile, false);

  if public.access_role_for_user(v_user_id) not in ('band_member', 'member')
    or (
      not public.auth_user_has_kakao_identity(v_user_id)
      and not v_is_production_test_member
    )
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = v_user_id
        and accounts.account_status = 'active'
    )
    or (
      v_requires_verified_profile
      and not v_is_production_test_member
      and not exists (
        select 1
        from public.kakao_member_profiles as kakao_profiles
        where kakao_profiles.member_id = v_user_id
          and kakao_profiles.profile_complete
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = '입금 요청을 만들 수 있는 카카오 회원 계정이 아닙니다.';
  end if;

  select settings.*
  into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for update;

  if not found
    or v_settings.active_mode <> 'manual_transfer'
    or v_settings.bank_name is null
    or v_settings.account_number is null
  then
    raise exception using
      errcode = 'P0001',
      message = '운영자가 입금 계좌를 설정한 후 주문할 수 있습니다.';
  end if;

  select orders.*
  into v_order
  from public.commerce_orders as orders
  where orders.id = p_order_id
    and orders.member_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '주문을 찾을 수 없습니다.';
  end if;
  if v_order.status <> 'awaiting_payment' then
    raise exception using errcode = '55000', message = '입금 대기 중인 주문이 아닙니다.';
  end if;

  select transfers.*
  into v_transfer
  from public.commerce_order_transfers as transfers
  where transfers.order_id = p_order_id
  for update;

  if found then
    if v_transfer.status = 'cancelled' then
      raise exception using errcode = '55000', message = '취소된 입금 요청입니다.';
    end if;
    return to_jsonb(v_transfer);
  end if;

  insert into public.commerce_order_transfers (
    order_id,
    member_id,
    expected_amount,
    bank_name_snapshot,
    account_number_snapshot
  )
  values (
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

revoke all on function public.create_commerce_order_transfer(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_order_transfer(uuid)
to authenticated;

comment on function public.create_commerce_order_transfer(uuid) is
  'Creates a manual-transfer request for Kakao members or the single active isolated production test member.';

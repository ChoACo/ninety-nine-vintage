-- Promote only the Kakao account explicitly selected by the service owner.
-- Using the owner RPC preserves all role checks, auth metadata synchronization,
-- and the support-routing trigger that assigns previously unrouted products.
do $$
declare
  v_owner_id constant uuid := '30be08c2-6259-42c6-af26-4ded6362de12'::uuid;
  v_operator_id constant uuid := '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'::uuid;
  v_result text;
begin
  if not exists (
    select 1
    from public.account_access_roles as roles
    join auth.identities as identities
      on identities.user_id = roles.user_id
     and identities.provider = 'kakao'
    where roles.user_id = v_owner_id
      and roles.role_code = 'owner'
  ) then
    raise exception using
      errcode = 'P0002',
      message = '승격을 승인할 카카오 소유자 계정을 확인할 수 없습니다.';
  end if;

  if not exists (
    select 1
    from public.account_access_roles as roles
    join public.profiles as profiles on profiles.id = roles.user_id
    join auth.identities as identities
      on identities.user_id = roles.user_id
     and identities.provider = 'kakao'
    where roles.user_id = v_operator_id
      and roles.role_code <> 'owner'
  ) then
    raise exception using
      errcode = 'P0002',
      message = '지정한 카카오 운영자 계정을 확인할 수 없습니다.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  v_result := public.set_member_access_role(v_operator_id, 'operator');

  if v_result <> 'operator' or not public.is_support_operator(v_operator_id) then
    raise exception using
      errcode = 'P0001',
      message = '카카오 운영자 승격 검증에 실패했습니다.';
  end if;

  if exists (
    select 1
    from public.products as products
    where products.inquiry_operator_id is null
       or not public.is_support_operator(products.inquiry_operator_id)
  ) then
    raise exception using
      errcode = 'P0001',
      message = '상품 문의 운영자 자동 배정에 실패했습니다.';
  end if;
end;
$$;

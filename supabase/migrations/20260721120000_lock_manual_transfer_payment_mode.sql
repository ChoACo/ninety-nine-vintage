-- Product policy: manual bank transfer is the only live payment path.
-- PortOne tables and functions remain intact for a future audited restoration.

update public.payment_runtime_settings
set active_mode = 'manual_transfer'
where singleton
  and active_mode <> 'manual_transfer';

create or replace function public.set_payment_runtime_mode(
  p_active_mode text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_active_mode is null
    or p_active_mode not in ('manual_transfer', 'portone')
  then
    raise exception using errcode = '22023', message = '결제 운영 모드를 확인해 주세요.';
  end if;
  if p_active_mode = 'portone' then
    raise exception using
      errcode = '55000',
      message = 'PortOne은 보관 상태입니다. 별도 재활성화 마이그레이션과 운영 검증이 필요합니다.';
  end if;

  update public.payment_runtime_settings
  set active_mode = 'manual_transfer', updated_by = auth.uid()
  where singleton;
  if not found then
    raise exception using errcode = 'P0002', message = '결제 설정을 찾지 못했습니다.';
  end if;
  return 'manual_transfer';
end;
$$;

revoke all on function public.set_payment_runtime_mode(text)
from public, anon;
grant execute on function public.set_payment_runtime_mode(text)
to authenticated;

comment on function public.set_payment_runtime_mode(text) is
  'Manual-transfer-only policy lock. PortOne restoration requires a new reviewed migration.';

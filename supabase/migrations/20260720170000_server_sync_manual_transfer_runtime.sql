-- The settings table deliberately denies direct table access, including to the
-- service role. This narrowly scoped RPC lets only the server's service-role
-- JWT synchronize environment-owned account details for legacy DB snapshots.

create or replace function public.sync_manual_transfer_runtime_settings(
  p_bank_name text,
  p_account_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_name text := btrim(coalesce(p_bank_name, ''));
  v_account_number text := btrim(coalesce(p_account_number, ''));
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = '서버 권한이 필요합니다.';
  end if;
  if char_length(v_bank_name) not between 2 and 40
    or char_length(v_account_number) not between 5 and 50
    or v_account_number !~ '^[0-9 -]+$'
  then
    raise exception using errcode = '22023', message = '은행명과 계좌번호를 확인해 주세요.';
  end if;

  update public.payment_runtime_settings
  set active_mode = 'manual_transfer',
      bank_name = v_bank_name,
      account_number = v_account_number
  where singleton;
  if not found then
    raise exception using errcode = 'P0002', message = '결제 설정을 찾지 못했습니다.';
  end if;
  return true;
end;
$$;

revoke all on function public.sync_manual_transfer_runtime_settings(text, text) from public, anon, authenticated;
grant execute on function public.sync_manual_transfer_runtime_settings(text, text) to service_role;

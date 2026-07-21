-- The shared business account is managed by the system owner from the site.
-- Runtime environment variables must not overwrite this setting.

create or replace function public.get_manual_transfer_settings()
returns table (
  active_mode text,
  bank_name text,
  account_number text,
  configured boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  return query
  select
    settings.active_mode,
    settings.bank_name,
    settings.account_number,
    settings.bank_name is not null and settings.account_number is not null,
    settings.updated_at
  from public.payment_runtime_settings as settings
  where settings.singleton;
end;
$$;

revoke all on function public.get_manual_transfer_settings()
from public, anon;
grant execute on function public.get_manual_transfer_settings()
to authenticated;

create or replace function public.update_manual_transfer_settings(
  p_bank_name text,
  p_account_number text
)
returns table (
  active_mode text,
  bank_name text,
  account_number text,
  configured boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_name text := btrim(coalesce(p_bank_name, ''));
  v_account_number text := btrim(coalesce(p_account_number, ''));
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(v_bank_name) not between 2 and 40
    or char_length(v_account_number) not between 5 and 50
    or v_account_number !~ '^[0-9 -]+$'
  then
    raise exception using errcode = '22023', message = '은행명과 계좌번호를 확인해 주세요.';
  end if;

  update public.payment_runtime_settings as settings
  set
    active_mode = 'manual_transfer',
    bank_name = v_bank_name,
    account_number = v_account_number,
    updated_by = auth.uid()
  where settings.singleton;
  if not found then
    raise exception using errcode = 'P0002', message = '결제 설정을 찾지 못했습니다.';
  end if;

  return query
  select
    settings.active_mode,
    settings.bank_name,
    settings.account_number,
    true,
    settings.updated_at
  from public.payment_runtime_settings as settings
  where settings.singleton;
end;
$$;

revoke all on function public.update_manual_transfer_settings(text, text)
from public, anon;
grant execute on function public.update_manual_transfer_settings(text, text)
to authenticated;

create or replace function public.get_manual_transfer_account_for_service()
returns table (
  bank_name text,
  account_number text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = '서버 권한이 필요합니다.';
  end if;

  return query
  select
    settings.bank_name,
    settings.account_number,
    settings.updated_at
  from public.payment_runtime_settings as settings
  where settings.singleton
    and settings.active_mode = 'manual_transfer';
end;
$$;

revoke all on function public.get_manual_transfer_account_for_service()
from public, anon, authenticated, service_role;
grant execute on function public.get_manual_transfer_account_for_service()
to service_role;

-- Retain the legacy function definition for migration history, but prevent any
-- runtime path from restoring environment-owned settings.
revoke all on function public.sync_manual_transfer_runtime_settings(text, text)
from public, anon, authenticated, service_role;

comment on function public.get_manual_transfer_account_for_service() is
  'Server-only read of the owner-managed shared manual-transfer account.';
comment on function public.update_manual_transfer_settings(text, text) is
  'Owner-only shared business account update; audited by payment settings trigger.';

begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Historical provider identifiers remain readable, but no new provider row or
-- provider state transition may be created after the manual-transfer cutover.
update public.payment_runtime_settings
set active_mode = 'manual_transfer', updated_at = clock_timestamp()
where active_mode <> 'manual_transfer';

alter table public.payment_runtime_settings
  drop constraint if exists payment_runtime_settings_active_mode_check;
alter table public.payment_runtime_settings
  add constraint payment_runtime_settings_active_mode_check
  check (active_mode = 'manual_transfer') not valid;
alter table public.payment_runtime_settings
  validate constraint payment_runtime_settings_active_mode_check;

drop trigger if exists payment_orders_fulfil_paid_commerce_order
on public.payment_orders;
drop trigger if exists payment_orders_revoke_refunded_commerce_order
on public.payment_orders;
drop trigger if exists payment_orders_reject_manual_overlap
on public.payment_orders;
drop trigger if exists payment_orders_reject_manual_transfer_double_settlement
on public.payment_orders;
drop trigger if exists commerce_order_transfers_reject_portone_overlap
on public.commerce_order_transfers;

drop function if exists public.prepare_commerce_portone_checkout(
  uuid, uuid[], text, text, text, text
);
drop function if exists public.prepare_commerce_portone_checkout(
  uuid, uuid[], text, text, text, text, boolean
);
drop function if exists public.prepare_portone_payment(uuid, uuid, text, text, text);
drop function if exists public.sync_portone_payment(
  text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, timestamptz
);

drop function if exists app_private.fulfil_paid_commerce_portone_order();
drop function if exists app_private.revoke_refunded_commerce_portone_order();
drop function if exists app_private.reject_commerce_manual_portone_overlap();
drop function if exists app_private.reject_portone_manual_overlap();
drop function if exists app_private.reject_portone_after_manual_settlement();
drop function if exists public.portone_payment_status_rank(text);
drop function if exists public.portone_payment_status_label(text);

drop function if exists public.set_payment_runtime_mode(text);
drop function if exists public.get_payment_runtime_mode_for_service();

create or replace function app_private.guard_legacy_provider_payment_history_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = '과거 결제대행 기록은 읽기 전용입니다.';
end;
$$;

revoke all on function app_private.guard_legacy_provider_payment_history_immutable()
from public, anon, authenticated, service_role;

drop trigger if exists payment_orders_legacy_provider_history_immutable
on public.payment_orders;
create trigger payment_orders_legacy_provider_history_immutable
before insert or update or delete on public.payment_orders
for each row execute function app_private.guard_legacy_provider_payment_history_immutable();

drop trigger if exists payment_attempts_legacy_provider_history_immutable
on public.payment_attempts;
create trigger payment_attempts_legacy_provider_history_immutable
before insert or update or delete on public.payment_attempts
for each row execute function app_private.guard_legacy_provider_payment_history_immutable();

revoke insert, update, delete on table public.payment_orders
from public, anon, authenticated, service_role;
revoke insert, update, delete on table public.payment_attempts
from public, anon, authenticated, service_role;
grant select on table public.payment_orders to authenticated, service_role;
grant select on table public.payment_attempts to authenticated, service_role;

comment on table public.payment_orders is
  'Read-only historical payment-provider order identifiers; no live provider execution remains.';
comment on table public.payment_attempts is
  'Read-only historical payment-provider attempts retained only for customer and audit history.';

commit;

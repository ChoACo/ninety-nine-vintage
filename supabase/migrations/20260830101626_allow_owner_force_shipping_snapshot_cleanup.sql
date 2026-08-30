-- Shipping charge snapshots remain immutable for every normal caller. The
-- existing Owner-only ledger-repair transaction gate is the sole exception so
-- a complete force rollback/purge cannot be stranded by an otherwise-correct
-- ON DELETE CASCADE.
create or replace function app_private.guard_commerce_shipping_allocation_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app_private.owner_force_ledger_enabled() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception using errcode = '42501', message = '주문 배송 단위 스냅샷은 변경할 수 없습니다.';
end;
$$;

revoke all on function app_private.guard_commerce_shipping_allocation_immutable()
from public, anon, authenticated, service_role;

comment on function app_private.guard_commerce_shipping_allocation_immutable() is
  'Keeps commerce shipping snapshots immutable except inside the authenticated Owner ledger-repair transaction gate.';

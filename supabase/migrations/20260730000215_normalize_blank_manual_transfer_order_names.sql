begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function app_private.normalize_manual_transfer_order_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_compact_id text := replace(lower(new.product_id::text), '-', '');
  v_display_hash bigint := 2166136261;
  v_position integer;
begin
  new.order_name := left(btrim(coalesce(new.order_name, '')), 160);

  if new.order_name = '' then
    for v_position in 1..char_length(v_compact_id) loop
      v_display_hash := (
        (
          (v_display_hash # ascii(substr(v_compact_id, v_position, 1))::bigint)
          * 16777619::bigint
        )
        & 4294967295::bigint
      );
    end loop;

    new.order_name := '상품 No. ' || to_char(
      100 + (v_display_hash % 999900),
      'FM999,999,999'
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.normalize_manual_transfer_order_name()
from public, anon, authenticated, service_role;

drop trigger if exists manual_transfer_orders_normalize_order_name
on public.manual_transfer_orders;
create trigger manual_transfer_orders_normalize_order_name
before insert or update of product_id, order_name
on public.manual_transfer_orders
for each row
execute function app_private.normalize_manual_transfer_order_name();

comment on function app_private.normalize_manual_transfer_order_name() is
  'Keeps auction transfer labels within the order-name contract and maps intentionally blank product titles to the same stable public product number.';

commit;

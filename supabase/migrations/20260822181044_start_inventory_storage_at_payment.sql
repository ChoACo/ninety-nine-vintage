begin;

-- Paid ownership is already located at the selling store. Storage therefore
-- starts at the authoritative payment timestamp; no separate physical intake
-- or release command is part of the current direct-store workflow.
create or replace function app_private.start_inventory_storage_at_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.paid_at is not null and new.storage_started_at is null then
    new.storage_started_at := new.paid_at;
    new.storage_expires_at := new.paid_at + make_interval(
      days => case when new.storage_duration_days = 7 then 7 else 14 end
    );
  elsif new.storage_started_at is not null and new.storage_expires_at is null then
    new.storage_expires_at := new.storage_started_at + make_interval(
      days => case when new.storage_duration_days = 7 then 7 else 14 end
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.start_inventory_storage_at_payment()
from public, anon, authenticated;

drop trigger if exists customer_inventory_items_start_storage_at_payment
on public.customer_inventory_items;

create trigger customer_inventory_items_start_storage_at_payment
before insert or update of paid_at, storage_started_at, storage_expires_at,
  storage_duration_days
on public.customer_inventory_items
for each row
execute function app_private.start_inventory_storage_at_payment();

-- Repair only rows whose timer was never started. Existing historical storage
-- timestamps remain immutable evidence and are not rewritten.
update public.customer_inventory_items
set storage_started_at = paid_at,
    storage_expires_at = paid_at + make_interval(
      days => case when storage_duration_days = 7 then 7 else 14 end
    )
where paid_at is not null
  and storage_started_at is null;

-- Retire the former operator intake/release surface at the database boundary.
-- The functions remain as historical schema compatibility but are no longer
-- executable through authenticated Data API sessions.
revoke all on function public.get_direct_store_fulfillment_groups(date, integer, integer)
from public, anon, authenticated;
revoke all on function public.release_buyer_paid_inventory_items(uuid[], bigint[], uuid, text)
from public, anon, authenticated;
revoke all on function public.release_buyer_inventory_shipment_items(uuid, uuid[], bigint, uuid, text)
from public, anon, authenticated;

comment on function app_private.start_inventory_storage_at_payment() is
  'Starts the 7/14-day customer storage timer at the authoritative payment timestamp.';

commit;

-- Keep the restrictive final-bid foreign key intact while allowing the trusted
-- Owner force-rollback transaction to detach the product before deleting the
-- referenced bid. Regular bid deletes remain protected by the FK.
create or replace function app_private.detach_owner_force_final_bid_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.owner_force_ledger_enabled() then
    return old;
  end if;

  perform set_config('app.authoritative_bid_product_id', old.product_id::text, true);

  update public.products
  set
    bid_locked_at = null,
    final_bid_id = null,
    final_bid_amount = null,
    sale_completed_at = null,
    updated_at = clock_timestamp()
  where id = old.product_id
    and final_bid_id = old.id;

  return old;
end;
$$;

revoke all on function app_private.detach_owner_force_final_bid_reference()
from public, anon, authenticated, service_role;

drop trigger if exists detach_owner_force_final_bid_reference
on public.auction_bids;

create trigger detach_owner_force_final_bid_reference
before delete on public.auction_bids
for each row
execute function app_private.detach_owner_force_final_bid_reference();

-- The force rollback function records these two entity kinds, so the immutable
-- audit table must accept them. The previous constraint caused the otherwise
-- successful transaction to roll back at its final audit insert.
alter table public.owner_ledger_repair_events
  drop constraint if exists owner_ledger_repair_events_entity_type_check;

alter table public.owner_ledger_repair_events
  add constraint owner_ledger_repair_events_entity_type_check
  check (entity_type in (
    'auction_bid',
    'auction_payment',
    'commerce_order',
    'legacy_payment',
    'inventory_item',
    'shipment'
  ));

-- Keep carts usable when a store is created before its operator saves shipping settings.

begin;

with resolved as (
  select
    stores.id,
    coalesce(
      stores.regular_shipping_fee,
      settings.shipping_fee_amount,
      3500
    ) as regular_fee,
    greatest(
      coalesce(
        stores.remote_area_shipping_fee,
        settings.shipping_fee_amount,
        3500
      ),
      coalesce(
        stores.regular_shipping_fee,
        settings.shipping_fee_amount,
        3500
      )
    ) as remote_fee
  from public.stores
  left join public.inventory_fulfillment_rollout_settings settings
    on settings.business_id = stores.business_id
  where stores.regular_shipping_fee is null
     or stores.remote_area_shipping_fee is null
)
update public.stores stores
set
  regular_shipping_fee = resolved.regular_fee,
  remote_area_shipping_fee = resolved.remote_fee
from resolved
where stores.id = resolved.id;

alter table public.stores
  alter column regular_shipping_fee set default 3500,
  alter column remote_area_shipping_fee set default 3500;

commit;

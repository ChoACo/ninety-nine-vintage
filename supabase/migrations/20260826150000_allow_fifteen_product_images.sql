begin;

-- The operator UI and guarded create API accept up to 15 ordered product
-- photos. Keep the authoritative insert policy aligned so direct R2 uploads do
-- not succeed only to have the database reject images 13 through 15.
drop policy if exists "Staff insert products" on public.products;
create policy "Staff insert products"
on public.products
for insert
to authenticated
with check (
  (select public.can_manage_products())
  and store_id is not null
  and (select public.can_manage_product_store(store_id))
  and exists (
    select 1
    from public.stores as stores
    where stores.id = store_id
      and stores.is_active
  )
  and created_by = (select public.current_owner_delegated_operator())
  and updated_by = (select public.current_owner_delegated_operator())
  and status = 'pending'
  and participant_count = 0
  and current_price = starting_price
  and bid_history = '[]'::jsonb
  and bid_locked_at is null
  and final_bid_id is null
  and final_bid_amount is null
  and anti_sniping_extension_count = 0
  and anti_sniping_base_closes_at is null
  and anti_sniping_extended_at is null
  and cardinality(image_urls) between 1 and 15
  and cardinality(thumbnail_urls) = cardinality(image_urls)
  and not exists (
    select 1
    from unnest(image_urls || thumbnail_urls) as images(url)
    where images.url is null
      or char_length(images.url) > 4096
      or images.url !~* '^https?://'
      or images.url ~* '/storage/v1/render/image/public/'
  )
  and (
    (sale_type = 'auction' and fixed_price is null)
    or (
      sale_type = 'fixed'
      and fixed_price between 1 and 1000000000
      and starting_price = fixed_price
      and current_price = fixed_price
    )
  )
);

commit;

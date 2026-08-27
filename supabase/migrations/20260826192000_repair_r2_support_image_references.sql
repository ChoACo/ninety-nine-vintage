begin;

set local lock_timeout = '10s';

-- These eleven snapshots were independently verified with a 200 HEAD against
-- the R2 public domain before this migration was written. The source bucket is
-- already empty, so only verified references are rewritten.
update public.support_messages
set product_image_url_snapshot = replace(
  product_image_url_snapshot,
  'https://bkwesxsznqupoqnwzzmn.supabase.co/storage/v1/object/public/product-images/',
  'https://cdn.ninety-nine-vintage.store/'
)
where product_image_url_snapshot like
  'https://bkwesxsznqupoqnwzzmn.supabase.co/storage/v1/object/public/product-images/%'
  and id <> '3768c69f-ad1b-497f-994b-492559ac1d2b'::uuid;

-- This deleted product's historical snapshot has no object in either source
-- Supabase Storage or R2. Nulling the optional image avoids a permanent broken
-- image while retaining the message and title audit history.
update public.support_messages
set product_image_url_snapshot = null
where id = '3768c69f-ad1b-497f-994b-492559ac1d2b'::uuid
  and product_image_url_snapshot =
    'https://bkwesxsznqupoqnwzzmn.supabase.co/storage/v1/object/public/product-images/products/e70c6f26-7fe8-4480-aacd-0c5c037f6cd1/images/1787299046220-052c026f-e0d4-4a4e-95f3-b7596e2830e7.webp';

commit;

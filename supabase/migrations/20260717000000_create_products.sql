create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  category text not null default '구제 의류',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  publish_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null check (status in ('pending', 'active', 'closed')),
  participant_count integer not null default 0 check (participant_count >= 0),
  starting_price bigint not null check (starting_price > 0),
  current_price bigint not null check (current_price > 0),
  bid_increment integer not null default 1000 check (bid_increment > 0),
  image_urls text[] not null check (cardinality(image_urls) > 0),
  bid_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(bid_history) = 'array')
);

create index if not exists products_public_feed_idx
  on public.products (status, publish_at desc);

create or replace function public.set_products_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_products_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.products enable row level security;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

drop policy if exists "Public reads published products" on public.products;
create policy "Public reads published products"
on public.products
for select
to anon, authenticated
using (status = 'active' and publish_at <= now());

drop policy if exists "Admins read every product" on public.products;
create policy "Admins read every product"
on public.products
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins insert products" on public.products;
create policy "Admins insert products"
on public.products
for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "Admins update products" on public.products;
create policy "Admins update products"
on public.products
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Admins delete products" on public.products;
create policy "Admins delete products"
on public.products
for delete
to authenticated
using ((select public.is_admin()));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads product images" on storage.objects;
create policy "Public reads product images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

drop policy if exists "Admins update product images" on storage.objects;
create policy "Admins update product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
)
with check (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
);

do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'activate-scheduled-products'
  ) then
    perform cron.schedule(
      'activate-scheduled-products',
      '* * * * *',
      $job$
        update public.products
        set status = 'active'
        where status = 'pending'
          and publish_at <= now();
      $job$
    );
  end if;
end;
$$;

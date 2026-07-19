-- Persistent member wishlist and small server-side primitives used by the
-- operator console. Local storage remains only as an offline UI cache.

create table if not exists public.wishlist_items (
  member_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, product_id)
);

alter table public.wishlist_items enable row level security;
drop policy if exists "Members manage their wishlist" on public.wishlist_items;
create policy "Members manage their wishlist"
  on public.wishlist_items for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

create index if not exists wishlist_items_member_created_idx
  on public.wishlist_items (member_id, created_at desc);

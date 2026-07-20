create table if not exists public.site_status (
  singleton boolean primary key default true check (singleton),
  status text not null default 'operational' check (status in ('operational', 'maintenance', 'preparing')),
  message text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.site_status (singleton, status, message)
values (true, 'operational', '')
on conflict (singleton) do nothing;

alter table public.site_status enable row level security;

revoke all on table public.site_status from anon, authenticated;

comment on table public.site_status is 'Singleton public site availability state. Read and write through server APIs.';

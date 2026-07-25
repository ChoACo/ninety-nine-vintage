begin;

set local lock_timeout = '10s';

create table public.member_experience_preferences (
  user_id uuid primary key
    references public.profiles(id) on delete cascade,
  simple_mode_enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.member_experience_preferences enable row level security;
alter table public.member_experience_preferences force row level security;

revoke all on table public.member_experience_preferences
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.member_experience_preferences
  to authenticated, service_role;

create policy "Members read their experience preferences"
  on public.member_experience_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Members create their experience preferences"
  on public.member_experience_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Members update their experience preferences"
  on public.member_experience_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function app_private.set_member_experience_preferences_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.set_member_experience_preferences_updated_at()
  from public, anon, authenticated, service_role;

create trigger member_experience_preferences_set_updated_at
before update on public.member_experience_preferences
for each row execute function app_private.set_member_experience_preferences_updated_at();

create or replace function app_private.initialize_member_experience_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_experience_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.initialize_member_experience_preferences()
  from public, anon, authenticated, service_role;

create trigger profiles_initialize_member_experience_preferences
after insert on public.profiles
for each row execute function app_private.initialize_member_experience_preferences();

insert into public.member_experience_preferences (user_id)
select profiles.id
from public.profiles
on conflict (user_id) do nothing;

drop index if exists public.web_push_subscriptions_active_standalone_user_idx;

create index if not exists web_push_subscriptions_active_delivery_user_idx
  on public.web_push_subscriptions (user_id, delivery_mode, updated_at desc)
  where disabled_at is null;

comment on table public.member_experience_preferences
  is 'Per-member accessibility and shopping experience preferences shared across devices.';
comment on column public.member_experience_preferences.simple_mode_enabled
  is 'Keeps the reduced large-control shopping mode active across browser restarts and signed-in devices.';
comment on column public.web_push_subscriptions.delivery_mode
  is 'Mobile browser and installed web-app subscriptions eligible for background delivery when the platform supports Web Push.';

commit;

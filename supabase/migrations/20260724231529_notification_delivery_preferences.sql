begin;

set local lock_timeout = '10s';

create table public.notification_preferences (
  user_id uuid primary key
    references public.profiles(id) on delete cascade,
  consent_state text not null default 'pending'
    check (consent_state in ('pending', 'granted', 'declined')),
  foreground_enabled boolean not null default true,
  background_push_enabled boolean not null default true,
  auction_enabled boolean not null default true,
  chat_enabled boolean not null default true,
  shipment_enabled boolean not null default true,
  payment_verification_enabled boolean not null default true,
  shipping_request_enabled boolean not null default true,
  system_enabled boolean not null default true,
  consented_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint notification_preferences_consent_time_check check (
    consent_state = 'pending'
    or consented_at is not null
  )
);

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

revoke all on table public.notification_preferences
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.notification_preferences
  to authenticated, service_role;

create policy "Users read their notification preferences"
  on public.notification_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their notification preferences"
  on public.notification_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their notification preferences"
  on public.notification_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function app_private.set_notification_preferences_updated_at()
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

revoke all on function app_private.set_notification_preferences_updated_at()
  from public, anon, authenticated, service_role;

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function app_private.set_notification_preferences_updated_at();

create or replace function app_private.initialize_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.initialize_notification_preferences()
  from public, anon, authenticated, service_role;

create trigger profiles_initialize_notification_preferences
after insert on public.profiles
for each row execute function app_private.initialize_notification_preferences();

insert into public.notification_preferences (user_id)
select profiles.id
from public.profiles
on conflict (user_id) do nothing;

alter table public.web_push_subscriptions
  add column delivery_mode text not null default 'browser';

alter table public.web_push_subscriptions
  add constraint web_push_subscriptions_delivery_mode_check
  check (delivery_mode in ('browser', 'standalone'));

update public.web_push_subscriptions
set disabled_at = coalesce(disabled_at, clock_timestamp())
where disabled_at is null;

update public.web_push_notification_outbox
set
  delivered_at = clock_timestamp(),
  locked_at = null,
  last_error = 'notification_preferences_migration'
where delivered_at is null;

create index web_push_subscriptions_active_standalone_user_idx
  on public.web_push_subscriptions (user_id, updated_at desc)
  where disabled_at is null and delivery_mode = 'standalone';

create or replace function app_private.notification_preference_allows(
  p_user_id uuid,
  p_kind text,
  p_delivery text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      preferences.consent_state = 'granted'
      and case p_delivery
        when 'background' then preferences.background_push_enabled
        else preferences.foreground_enabled
      end
      and case p_kind
        when 'auction_won' then preferences.auction_enabled
        when 'chat_message' then preferences.chat_enabled
        when 'shipment_tracking_registered' then preferences.shipment_enabled
        when 'payment_verification_requested'
          then preferences.payment_verification_enabled
        when 'shipping_requested' then preferences.shipping_request_enabled
        else preferences.system_enabled
      end
    from public.notification_preferences as preferences
    where preferences.user_id = p_user_id
  ), false);
$$;

revoke all on function app_private.notification_preference_allows(
  uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function app_private.enqueue_web_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_id is not null
    and app_private.notification_preference_allows(
      new.member_id,
      new.kind,
      'background'
    )
  then
    insert into public.web_push_notification_outbox (
      notification_id,
      recipient_user_id,
      topic,
      title,
      body,
      url
    )
    values (
      new.id,
      new.member_id,
      left(new.kind, 80),
      left(new.title, 160),
      left(new.body, 1000),
      case
        when coalesce(new.href, '') ~ '^/' then left(new.href, 2048)
        else '/m/home'
      end
    )
    on conflict (notification_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function app_private.enqueue_web_push_notification()
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

comment on table public.notification_preferences
  is 'Per-user foreground and installed-web-app notification consent and category switches.';
comment on column public.web_push_subscriptions.delivery_mode
  is 'Only standalone mobile web-app subscriptions are eligible for background delivery.';

commit;

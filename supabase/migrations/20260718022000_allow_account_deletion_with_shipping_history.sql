-- Permit account deletion while preserving the minimum shipping history needed
-- for transaction records. The direct member link is removed on profile delete.
alter table public.shipping_requests
  add column if not exists member_deleted_at timestamptz;

alter table public.shipping_requests
  alter column member_id drop not null;

alter table public.shipping_requests
  drop constraint if exists shipping_requests_member_id_fkey;
alter table public.shipping_requests
  add constraint shipping_requests_member_id_fkey
  foreign key (member_id)
  references public.profiles (id)
  on delete set null;

create or replace function public.anonymize_member_shipping_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shipping_requests
  set
    member_id = null,
    member_deleted_at = clock_timestamp()
  where member_id = old.id;
  return old;
end;
$$;

revoke all on function public.anonymize_member_shipping_history() from public;

drop trigger if exists profiles_anonymize_shipping_history on public.profiles;
create trigger profiles_anonymize_shipping_history
before delete on public.profiles
for each row execute function public.anonymize_member_shipping_history();

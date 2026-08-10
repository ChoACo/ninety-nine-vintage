begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- The owner queue is an escalation queue, not a list of every open transfer.
-- Keep the 12-hour policy in the database so every caller receives the same
-- contract and the UI cannot label a younger request as overdue.
create or replace function public.get_owner_payment_confirmation_queue()
returns table(
  request_id uuid,
  order_id uuid,
  buyer_display_name text,
  expected_amount bigint,
  transfer_status text,
  first_requested_at timestamptz,
  last_requested_at timestamptz,
  reminder_count integer,
  elapsed_seconds bigint,
  request_version bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  return query
  select requests.id, requests.order_id, profiles.display_name,
    transfers.expected_amount, transfers.status,
    requests.first_requested_at, requests.last_requested_at,
    requests.reminder_count,
    greatest(0, extract(epoch from clock_timestamp() - requests.first_requested_at)::bigint),
    requests.version
  from public.commerce_payment_confirmation_requests as requests
  join public.commerce_order_transfers as transfers on transfers.id = requests.transfer_id
  join public.profiles on profiles.id = requests.member_id
  where requests.status = 'open'
    and requests.first_requested_at <= clock_timestamp() - interval '12 hours'
  order by requests.reminder_count desc, requests.first_requested_at asc;
end;
$$;

revoke all on function public.get_owner_payment_confirmation_queue()
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_payment_confirmation_queue()
to authenticated;

comment on function public.get_owner_payment_confirmation_queue() is
  'Owner-only escalation queue containing open confirmation requests at least 12 hours old.';

commit;

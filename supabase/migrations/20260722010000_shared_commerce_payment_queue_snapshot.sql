begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The operator queue is a shared business-wide payment queue. Read active and
-- completed lanes, their CAS balance/version, and recent audit rows from one
-- PostgreSQL statement snapshot so a transition cannot appear in both lanes
-- or disappear between two Data API requests.
create index if not exists commerce_order_transfers_queue_status_requested_idx
  on public.commerce_order_transfers (status, requested_at desc, id desc);

create index if not exists manual_transfer_payment_ledger_commerce_queue_idx
  on public.manual_transfer_payment_ledger
    (commerce_order_transfer_id, created_at desc, id desc)
  where transfer_kind = 'commerce';

create or replace function public.get_shared_commerce_payment_queue_page(
  p_history_limit integer default 100,
  p_history_before_activity_at timestamptz default null,
  p_history_before_transfer_id uuid default null,
  p_summary_only boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_history_limit is null
    or p_history_limit not between 1 and 100
    or p_summary_only is null
    or (p_history_before_activity_at is null) <> (p_history_before_transfer_id is null)
    or (
      p_history_before_activity_at is not null
      and not isfinite(p_history_before_activity_at)
    )
    or (
      p_summary_only
      and p_history_before_activity_at is not null
    )
  then
    raise exception using errcode = '22023', message = '조회 기준이 올바르지 않습니다.';
  end if;

  with
  active_probe as materialized (
    select
      transfers.id,
      transfers.order_id,
      transfers.member_id,
      transfers.expected_amount,
      transfers.status,
      transfers.bank_name_snapshot,
      transfers.account_number_snapshot,
      transfers.requested_at,
      transfers.confirmed_at,
      transfers.confirmed_by,
      greatest(
        transfers.requested_at,
        coalesce(transfers.confirmed_at, transfers.requested_at),
        coalesce(ledger_totals.ledger_max_created_at, transfers.requested_at)
      ) as activity_at,
      ledger_totals.received_amount,
      ledger_totals.ledger_entry_count
    from public.commerce_order_transfers as transfers
    left join lateral (
      select
        coalesce(sum(
          case
            when ledger.entry_type = 'receipt' then ledger.amount
            when ledger.entry_type = 'reversal' then -ledger.amount
            else 0
          end
        ), 0)::bigint as received_amount,
        count(ledger.id)::bigint as ledger_entry_count,
        max(ledger.created_at) as ledger_max_created_at
      from public.manual_transfer_payment_ledger as ledger
      where ledger.transfer_kind = 'commerce'
        and ledger.commerce_order_transfer_id = transfers.id
    ) as ledger_totals on true
    where transfers.status in ('awaiting_transfer', 'partially_paid')
    order by activity_at desc, transfers.id desc
    limit 401
  ),
  active_meta as materialized (
    select
      count(*)::integer as active_count,
      count(*) > 400 as active_overflow
    from active_probe
  ),
  history_candidates as materialized (
    select
      transfers.id,
      transfers.order_id,
      transfers.member_id,
      transfers.expected_amount,
      transfers.status,
      transfers.bank_name_snapshot,
      transfers.account_number_snapshot,
      transfers.requested_at,
      transfers.confirmed_at,
      transfers.confirmed_by,
      greatest(
        transfers.requested_at,
        coalesce(transfers.confirmed_at, transfers.requested_at),
        coalesce(ledger_totals.ledger_max_created_at, transfers.requested_at)
      ) as activity_at,
      ledger_totals.received_amount,
      ledger_totals.ledger_entry_count
    from public.commerce_order_transfers as transfers
    cross join active_meta
    left join lateral (
      select
        coalesce(sum(
          case
            when ledger.entry_type = 'receipt' then ledger.amount
            when ledger.entry_type = 'reversal' then -ledger.amount
            else 0
          end
        ), 0)::bigint as received_amount,
        count(ledger.id)::bigint as ledger_entry_count,
        max(ledger.created_at) as ledger_max_created_at
      from public.manual_transfer_payment_ledger as ledger
      where ledger.transfer_kind = 'commerce'
        and ledger.commerce_order_transfer_id = transfers.id
    ) as ledger_totals on true
    where not p_summary_only
      and not active_meta.active_overflow
      and transfers.status in ('confirmed', 'cancelled')
  ),
  history_probe as materialized (
    select history_candidates.*
    from history_candidates
    where p_history_before_activity_at is null
      or (
        history_candidates.activity_at,
        history_candidates.id
      ) < (
        p_history_before_activity_at,
        p_history_before_transfer_id
      )
    order by history_candidates.activity_at desc, history_candidates.id desc
    limit (p_history_limit + 1)
  ),
  history_page as materialized (
    select history_probe.*
    from history_probe
    order by history_probe.activity_at desc, history_probe.id desc
    limit p_history_limit
  ),
  selected_transfers as materialized (
    select 'active'::text as lane, active_probe.*
    from active_probe
    cross join active_meta
    where not p_summary_only
      and not active_meta.active_overflow

    union all

    select 'history'::text as lane, history_page.*
    from history_page
  ),
  integrity_meta as materialized (
    select exists (
      select 1
      from active_probe as queue_rows
      where queue_rows.received_amount < 0
        or queue_rows.received_amount > queue_rows.expected_amount
        or (
          queue_rows.status = 'awaiting_transfer'
          and queue_rows.received_amount <> 0
        )
        or (
          queue_rows.status = 'partially_paid'
          and (
            queue_rows.received_amount <= 0
            or queue_rows.received_amount >= queue_rows.expected_amount
          )
        )
    ) or exists (
      select 1
      from history_page as queue_rows
      where queue_rows.received_amount < 0
        or queue_rows.received_amount > queue_rows.expected_amount
        or (
          queue_rows.status = 'confirmed'
          and queue_rows.received_amount <> queue_rows.expected_amount
        )
        or (
          queue_rows.status = 'cancelled'
          and queue_rows.received_amount <> 0
        )
    ) as integrity_error
  ),
  ledger_display as materialized (
    select
      selected.id as transfer_id,
      count(recent_ledger.id)::bigint as displayed_entry_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', recent_ledger.id,
            'entry_type', recent_ledger.entry_type,
            'amount', recent_ledger.amount,
            'depositor_name', recent_ledger.depositor_name,
            'memo', recent_ledger.memo,
            'reversal_of', recent_ledger.reversal_of,
            'recorded_by', recent_ledger.recorded_by,
            'created_at', recent_ledger.created_at
          )
          order by recent_ledger.created_at desc, recent_ledger.id desc
        ) filter (where recent_ledger.id is not null),
        '[]'::jsonb
      ) as ledger
    from selected_transfers as selected
    left join lateral (
      select
        ledger.id,
        ledger.entry_type,
        ledger.amount,
        ledger.depositor_name,
        ledger.memo,
        ledger.reversal_of,
        ledger.recorded_by,
        ledger.created_at
      from public.manual_transfer_payment_ledger as ledger
      where ledger.transfer_kind = 'commerce'
        and ledger.commerce_order_transfer_id = selected.id
      order by ledger.created_at desc, ledger.id desc
      limit 100
    ) as recent_ledger on true
    group by selected.id
  ),
  rendered_transfers as materialized (
    select
      selected.lane,
      selected.id,
      selected.activity_at,
      jsonb_build_object(
        'id', selected.id,
        'order_id', selected.order_id,
        'member_id', selected.member_id,
        'expected_amount', selected.expected_amount,
        'status', selected.status,
        'bank_name_snapshot', selected.bank_name_snapshot,
        'account_number_snapshot', selected.account_number_snapshot,
        'requested_at', selected.requested_at,
        'confirmed_at', selected.confirmed_at,
        'confirmed_by', selected.confirmed_by,
        'activity_at', selected.activity_at,
        'received_amount', selected.received_amount,
        'ledger_entry_count', selected.ledger_entry_count,
        'remaining_amount', selected.expected_amount - selected.received_amount,
        'ledger_history_complete',
          ledger_display.displayed_entry_count = selected.ledger_entry_count,
        'ledger', ledger_display.ledger
      ) as payload
    from selected_transfers as selected
    join ledger_display on ledger_display.transfer_id = selected.id
  ),
  history_meta as materialized (
    select count(*) > p_history_limit as history_has_more
    from history_probe
  )
  select jsonb_build_object(
    'active_overflow', active_meta.active_overflow,
    'integrity_error', integrity_meta.integrity_error,
    'active_count', active_meta.active_count,
    'active', case
      when active_meta.active_overflow
        or integrity_meta.integrity_error
        or p_summary_only
      then '[]'::jsonb
      else coalesce((
        select jsonb_agg(
          rendered.payload
          order by rendered.activity_at desc, rendered.id desc
        )
        from rendered_transfers as rendered
        where rendered.lane = 'active'
      ), '[]'::jsonb)
    end,
    'history', case
      when active_meta.active_overflow
        or integrity_meta.integrity_error
        or p_summary_only
      then '[]'::jsonb
      else coalesce((
        select jsonb_agg(
          rendered.payload
          order by rendered.activity_at desc, rendered.id desc
        )
        from rendered_transfers as rendered
        where rendered.lane = 'history'
      ), '[]'::jsonb)
    end,
    'history_has_more', case
      when active_meta.active_overflow
        or integrity_meta.integrity_error
        or p_summary_only
      then false
      else history_meta.history_has_more
    end,
    'next_history_cursor', case
      when active_meta.active_overflow
        or integrity_meta.integrity_error
        or p_summary_only
        or not history_meta.history_has_more
      then null
      else (
        select jsonb_build_object(
          'activity_at', history_page.activity_at,
          'transfer_id', history_page.id
        )
        from history_page
        order by history_page.activity_at asc, history_page.id asc
        limit 1
      )
    end
  )
  into v_result
  from active_meta
  cross join integrity_meta
  cross join history_meta;

  return v_result;
end;
$$;

revoke all on function public.get_shared_commerce_payment_queue_page(
  integer,
  timestamptz,
  uuid,
  boolean
)
from public, anon, authenticated, service_role;
grant execute on function public.get_shared_commerce_payment_queue_page(
  integer,
  timestamptz,
  uuid,
  boolean
)
to authenticated;

commit;

-- Persist and safely maintain courier/tracking data for both individual and
-- spreadsheet-assisted shipping work. The existing shipping_requests table
-- already owns the durable courier/tracking columns; this migration adds a
-- bounded staff queue reader and one atomic batch mutation boundary.

alter table public.shipping_addresses
  add column if not exists postal_code text;

alter table public.shipping_addresses
  drop constraint if exists shipping_addresses_postal_code_check;
alter table public.shipping_addresses
  add constraint shipping_addresses_postal_code_check
  check (postal_code is null or postal_code ~ '^[0-9]{5}$');

-- Recover only unambiguous legacy values written at the beginning of the old
-- single address field. The address text itself stays untouched.
update public.shipping_addresses
set postal_code = case
  when btrim(address) ~ '^[0-9]{5}([[:space:]]|$)'
    then left(btrim(address), 5)
  when btrim(address) ~ '^\[[0-9]{5}\]'
    then substring(btrim(address) from 2 for 5)
  when btrim(address) ~ '^\([0-9]{5}\)'
    then substring(btrim(address) from 2 for 5)
  else null
end
where postal_code is null;

-- Preserve the existing six-argument call shape through a trailing defaulted
-- parameter, while allowing the member UI to save a normalized postal code.
drop function if exists public.upsert_my_shipping_address(
  uuid, text, text, text, text, boolean
);

create function public.upsert_my_shipping_address(
  p_id uuid,
  p_label text,
  p_recipient_name text,
  p_phone text,
  p_address text,
  p_is_default boolean default false,
  p_postal_code text default null
)
returns setof public.shipping_addresses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_address_id uuid := coalesce(p_id, gen_random_uuid());
  v_make_default boolean;
  v_postal_code text := nullif(btrim(coalesce(p_postal_code, '')), '');
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  perform 1
  from public.member_accounts as accounts
  where accounts.member_id = v_user_id
  for update;

  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 40
    or char_length(btrim(coalesce(p_recipient_name, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_phone, ''))) not between 7 and 30
    or char_length(btrim(coalesce(p_address, ''))) not between 5 and 500
    or (v_postal_code is not null and v_postal_code !~ '^[0-9]{5}$')
  then
    raise exception using errcode = '22023', message = '배송지 입력값을 확인해 주세요.';
  end if;

  if p_id is not null and not exists (
    select 1 from public.shipping_addresses as addresses
    where addresses.id = p_id and addresses.member_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = '수정할 배송지를 찾을 수 없습니다.';
  end if;

  -- An old client that does not yet send postal_code must not erase a value
  -- already saved by the newer address form.
  if v_postal_code is null and p_id is not null then
    select addresses.postal_code into v_postal_code
    from public.shipping_addresses as addresses
    where addresses.id = p_id and addresses.member_id = v_user_id;
  end if;

  v_make_default := coalesce(p_is_default, false) or not exists (
    select 1 from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id
  );

  if v_make_default then
    update public.shipping_addresses
    set is_default = false
    where member_id = v_user_id and is_default;
  end if;

  insert into public.shipping_addresses (
    id,
    member_id,
    label,
    recipient_name,
    phone,
    postal_code,
    address,
    is_default
  )
  values (
    v_address_id,
    v_user_id,
    btrim(p_label),
    btrim(p_recipient_name),
    btrim(p_phone),
    v_postal_code,
    btrim(p_address),
    v_make_default
  )
  on conflict (id) do update
  set
    label = excluded.label,
    recipient_name = excluded.recipient_name,
    phone = excluded.phone,
    postal_code = excluded.postal_code,
    address = excluded.address,
    is_default = excluded.is_default
  where public.shipping_addresses.member_id = v_user_id;

  if not exists (
    select 1 from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id and addresses.is_default
  ) then
    update public.shipping_addresses
    set is_default = true
    where id = (
      select addresses.id
      from public.shipping_addresses as addresses
      where addresses.member_id = v_user_id
      order by addresses.created_at, addresses.id
      limit 1
    );
  end if;

  update public.member_accounts
  set phone = (
    select addresses.phone
    from public.shipping_addresses as addresses
    where addresses.member_id = v_user_id and addresses.is_default
    limit 1
  )
  where member_id = v_user_id;

  return query
  select addresses.*
  from public.shipping_addresses as addresses
  where addresses.id = v_address_id and addresses.member_id = v_user_id;
end;
$$;

revoke all on function public.upsert_my_shipping_address(
  uuid, text, text, text, text, boolean, text
) from public, anon;
grant execute on function public.upsert_my_shipping_address(
  uuid, text, text, text, text, boolean, text
) to authenticated;

create or replace function public.set_shipping_request_postal_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal_code text;
begin
  if new.address_id is not null then
    select addresses.postal_code into v_postal_code
    from public.shipping_addresses as addresses
    where addresses.id = new.address_id
      and addresses.member_id = new.member_id;
  end if;

  if v_postal_code is not null then
    new.address_snapshot := new.address_snapshot ||
      jsonb_build_object('postalCode', v_postal_code);
  end if;
  return new;
end;
$$;

revoke all on function public.set_shipping_request_postal_snapshot()
from public, anon, authenticated;

drop trigger if exists shipping_requests_set_postal_snapshot
on public.shipping_requests;
create trigger shipping_requests_set_postal_snapshot
before insert on public.shipping_requests
for each row execute function public.set_shipping_request_postal_snapshot();

-- Backfill only snapshots whose own immutable address text contains an
-- unambiguous leading postal code. Current mutable address rows are not used
-- to rewrite historical recipient data.
update public.shipping_requests as requests
set address_snapshot = requests.address_snapshot || jsonb_build_object(
  'postalCode',
  case
    when btrim(coalesce(requests.address_snapshot ->> 'address', ''))
      ~ '^[0-9]{5}([[:space:]]|$)'
      then left(btrim(requests.address_snapshot ->> 'address'), 5)
    when btrim(coalesce(requests.address_snapshot ->> 'address', ''))
      ~ '^\[[0-9]{5}\]'
      then substring(btrim(requests.address_snapshot ->> 'address') from 2 for 5)
    when btrim(coalesce(requests.address_snapshot ->> 'address', ''))
      ~ '^\([0-9]{5}\)'
      then substring(btrim(requests.address_snapshot ->> 'address') from 2 for 5)
  end
)
where not requests.address_snapshot ? 'postalCode'
  and (
    btrim(coalesce(requests.address_snapshot ->> 'address', ''))
      ~ '^[0-9]{5}([[:space:]]|$)'
    or btrim(coalesce(requests.address_snapshot ->> 'address', ''))
      ~ '^\[[0-9]{5}\]'
    or btrim(coalesce(requests.address_snapshot ->> 'address', ''))
      ~ '^\([0-9]{5}\)'
  );

create or replace function public.get_shipping_work(
  p_include_shipped boolean default true,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  request_id uuid,
  member_id uuid,
  address_snapshot jsonb,
  status text,
  courier text,
  tracking_number text,
  requested_at timestamptz,
  shipped_at timestamptz,
  product_ids uuid[],
  item_count integer,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.access_role_for_user(auth.uid());
begin
  if auth.uid() is null or not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 업무 조회 권한이 없습니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = '배송 업무 조회 건수는 1건 이상 500건 이하여야 합니다.';
  end if;
  if p_offset is null or p_offset not between 0 and 1000000 then
    raise exception using errcode = '22023', message = '배송 업무 조회 시작 위치가 올바르지 않습니다.';
  end if;

  return query
  with work_rows as (
    select
      requests.id as request_id,
      requests.member_id,
      requests.address_snapshot,
      requests.status,
      requests.courier,
      requests.tracking_number,
      requests.requested_at,
      requests.shipped_at,
      array_agg(items.product_id order by items.created_at, items.product_id) as product_ids,
      count(items.product_id)::integer as item_count,
      requests.updated_at
    from public.shipping_requests as requests
    join public.shipping_request_items as items on items.request_id = requests.id
    where (
        requests.status = 'requested'
        or (
          coalesce(p_include_shipped, true)
          and v_actor_role in ('owner', 'operator')
          and requests.status = 'shipped'
        )
      )
      and not exists (
        select 1
        from public.owner_hidden_test_members as hidden_test
        where hidden_test.test_user_id = requests.member_id
      )
    group by
      requests.id,
      requests.member_id,
      requests.address_snapshot,
      requests.status,
      requests.courier,
      requests.tracking_number,
      requests.requested_at,
      requests.shipped_at,
      requests.updated_at
  )
  select
    work.request_id,
    work.member_id,
    work.address_snapshot,
    work.status,
    work.courier,
    work.tracking_number,
    work.requested_at,
    work.shipped_at,
    work.product_ids,
    work.item_count,
    work.updated_at,
    count(*) over()
  from work_rows as work
  order by
    case when work.status = 'requested' then 0 else 1 end,
    work.requested_at desc,
    work.request_id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_shipping_work(boolean, integer, integer)
from public, anon;
grant execute on function public.get_shipping_work(boolean, integer, integer)
to authenticated;

create or replace function public.count_shipping_work(
  p_include_shipped boolean default true
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_count bigint;
begin
  if auth.uid() is null or not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 업무 조회 권한이 없습니다.';
  end if;

  select count(*) into v_count
  from public.shipping_requests as requests
  where (
      requests.status = 'requested'
      or (
        coalesce(p_include_shipped, true)
        and v_actor_role in ('owner', 'operator')
        and requests.status = 'shipped'
      )
    )
    and exists (
      select 1
      from public.shipping_request_items as items
      where items.request_id = requests.id
    )
    and not exists (
      select 1
      from public.owner_hidden_test_members as hidden_test
      where hidden_test.test_user_id = requests.member_id
    );
  return v_count;
end;
$$;

revoke all on function public.count_shipping_work(boolean)
from public, anon;
grant execute on function public.count_shipping_work(boolean)
to authenticated;

-- Preserve the original queue RPC for older clients while applying the same
-- hidden-test-member boundary as the richer work-list RPC.
create or replace function public.get_pending_shipping_work()
returns table (
  request_id uuid,
  address_snapshot jsonb,
  requested_at timestamptz,
  product_ids uuid[],
  item_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 대기 조회 권한이 없습니다.';
  end if;

  return query
  select
    requests.id,
    requests.address_snapshot,
    requests.requested_at,
    array_agg(items.product_id order by items.created_at, items.product_id),
    count(items.product_id)::integer
  from public.shipping_requests as requests
  join public.shipping_request_items as items on items.request_id = requests.id
  where requests.status = 'requested'
    and not exists (
      select 1
      from public.owner_hidden_test_members as hidden_test
      where hidden_test.test_user_id = requests.member_id
    )
  group by requests.id, requests.address_snapshot, requests.requested_at
  order by requests.requested_at, requests.id;
end;
$$;

revoke all on function public.get_pending_shipping_work()
from public, anon;
grant execute on function public.get_pending_shipping_work()
to authenticated;

-- Keep one courier/tracking pair attached to exactly one shipping request.
-- A pre-existing duplicate must not make this migration undeployable, so the
-- unique index is installed when the current data permits it. The trigger is
-- always installed and serializes each normalized pair before checking it,
-- providing the same protection for future writes while legacy duplicates are
-- corrected deliberately.
do $$
begin
  if not exists (
    select 1
    from public.shipping_requests as requests
    where requests.status = 'shipped'
    group by lower(btrim(requests.courier)), btrim(requests.tracking_number)
    having count(*) > 1
  ) then
    create unique index if not exists shipping_requests_unique_tracking_idx
      on public.shipping_requests (
        lower(btrim(courier)),
        btrim(tracking_number)
      )
      where status = 'shipped';
  end if;
end;
$$;

create or replace function public.enforce_unique_shipping_tracking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tracking_key text;
begin
  if new.status = 'shipped' then
    v_tracking_key := lower(btrim(new.courier)) ||
      pg_catalog.chr(31) || btrim(new.tracking_number);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_tracking_key, 0)
    );

    if exists (
      select 1
      from public.shipping_requests as requests
      where requests.status = 'shipped'
        and lower(btrim(requests.courier)) = lower(btrim(new.courier))
        and btrim(requests.tracking_number) = btrim(new.tracking_number)
        and requests.id <> new.id
    ) then
      raise exception using
        errcode = '23505',
        constraint = 'shipping_requests_unique_tracking_idx',
        message = '동일한 택배사와 운송장 번호가 다른 배송 요청에 이미 등록되어 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_unique_shipping_tracking()
from public, anon, authenticated;

drop trigger if exists shipping_requests_enforce_unique_tracking
on public.shipping_requests;
create trigger shipping_requests_enforce_unique_tracking
before insert or update of status, courier, tracking_number
on public.shipping_requests
for each row execute function public.enforce_unique_shipping_tracking();

create or replace function public.upsert_shipping_tracking_batch(
  p_updates jsonb
)
returns table (
  request_id uuid,
  status text,
  courier text,
  tracking_number text,
  shipped_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_entry jsonb;
  v_request_id uuid;
  v_member_id uuid;
  v_courier text;
  v_tracking_number text;
  v_tracking_key text;
  v_tracking_keys text[] := '{}'::text[];
  v_request_ids uuid[] := '{}'::uuid[];
  v_request_status text;
  v_expected_updated_at timestamptz;
  v_current_updated_at timestamptz;
begin
  if auth.uid() is null or not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 처리 권한이 없습니다.';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception using errcode = '22023', message = '운송장 등록 내역은 JSON 배열이어야 합니다.';
  end if;
  if jsonb_array_length(p_updates) not between 1 and 500 then
    raise exception using errcode = '22023', message = '운송장 등록 내역은 1건 이상 500건 이하여야 합니다.';
  end if;

  -- Validate every value before the first write. Any invalid or duplicate row
  -- aborts the whole batch transaction.
  for v_entry in
    select entries.value
    from jsonb_array_elements(p_updates) with ordinality as entries(value, position)
    order by entries.position
  loop
    if jsonb_typeof(v_entry) <> 'object'
      or coalesce(v_entry ->> 'request_id', '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception using errcode = '22023', message = '배송 요청 식별자가 올바르지 않습니다.';
    end if;

    v_request_id := (v_entry ->> 'request_id')::uuid;
    v_courier := btrim(coalesce(v_entry ->> 'courier', ''));
    v_tracking_number := btrim(coalesce(v_entry ->> 'tracking_number', ''));

    begin
      v_expected_updated_at := (v_entry ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = '배송 요청 수정 시각이 올바르지 않습니다.';
    end;

    if v_request_id = any(v_request_ids) then
      raise exception using errcode = '22023', message = '중복된 배송 요청이 포함되어 있습니다.';
    end if;
    if v_expected_updated_at is null then
      raise exception using errcode = '22023', message = '배송 요청 수정 시각이 필요합니다.';
    end if;
    if char_length(v_courier) not between 1 and 80
      or char_length(v_tracking_number) not between 1 and 120
      or v_courier ~ '[[:cntrl:]]'
      or v_tracking_number ~ '[[:cntrl:]]'
    then
      raise exception using errcode = '22023', message = '택배사와 운송장 번호를 확인해 주세요.';
    end if;

    v_tracking_key := lower(v_courier) ||
      pg_catalog.chr(31) || v_tracking_number;
    if v_tracking_key = any(v_tracking_keys) then
      raise exception using errcode = '23505', message = '동일한 택배사와 운송장 번호가 엑셀 내역에 중복되어 있습니다.';
    end if;

    v_request_ids := array_append(v_request_ids, v_request_id);
    v_tracking_keys := array_append(v_tracking_keys, v_tracking_key);
  end loop;

  -- Lock targets in a deterministic order so overlapping spreadsheet imports
  -- cannot deadlock merely because their rows were arranged differently.
  for v_request_id in
    select selected.id
    from unnest(v_request_ids) as selected(id)
    order by selected.id
  loop
    select entries.value into v_entry
    from jsonb_array_elements(p_updates) as entries(value)
    where (entries.value ->> 'request_id')::uuid = v_request_id
    limit 1;
    v_expected_updated_at := (v_entry ->> 'expected_updated_at')::timestamptz;

    v_member_id := null;
    v_request_status := null;
    v_current_updated_at := null;
    select requests.member_id, requests.status, requests.updated_at
    into v_member_id, v_request_status, v_current_updated_at
    from public.shipping_requests as requests
    where requests.id = v_request_id
    for update;

    if not found or exists (
      select 1
      from public.owner_hidden_test_members as hidden_test
      where hidden_test.test_user_id = v_member_id
    ) then
      raise exception using errcode = 'P0002', message = '배송 요청을 찾을 수 없습니다.';
    end if;
    if v_expected_updated_at is distinct from v_current_updated_at then
      raise exception using errcode = '40001', message = '다른 사용자가 먼저 운송장 정보를 수정했습니다. 목록을 새로고침해 주세요.';
    end if;
    if v_actor_role = 'employee' and v_request_status <> 'requested' then
      raise exception using errcode = '42501', message = '직원은 배송 대기 건의 최초 운송장만 등록할 수 있습니다.';
    end if;
  end loop;

  -- Serialize normalized courier/tracking pairs in a stable order. This makes
  -- the friendly preflight check race-safe even when the conditional unique
  -- index could not be installed because of legacy duplicate rows.
  for v_tracking_key in
    select selected.key
    from unnest(v_tracking_keys) as selected(key)
    order by selected.key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_tracking_key, 0)
    );
  end loop;

  for v_entry in
    select entries.value
    from jsonb_array_elements(p_updates) with ordinality as entries(value, position)
    order by entries.position
  loop
    v_request_id := (v_entry ->> 'request_id')::uuid;
    v_courier := btrim(v_entry ->> 'courier');
    v_tracking_number := btrim(v_entry ->> 'tracking_number');

    if exists (
      select 1
      from public.shipping_requests as requests
      where requests.status = 'shipped'
        and lower(btrim(requests.courier)) = lower(v_courier)
        and btrim(requests.tracking_number) = v_tracking_number
        and requests.id <> v_request_id
    ) then
      raise exception using errcode = '23505', message = '동일한 택배사와 운송장 번호가 다른 배송 요청에 이미 등록되어 있습니다.';
    end if;
  end loop;

  for v_entry in
    select entries.value
    from jsonb_array_elements(p_updates) with ordinality as entries(value, position)
    order by entries.position
  loop
    v_request_id := (v_entry ->> 'request_id')::uuid;
    v_courier := btrim(v_entry ->> 'courier');
    v_tracking_number := btrim(v_entry ->> 'tracking_number');

    update public.shipping_requests as requests
    set
      status = 'shipped',
      courier = v_courier,
      tracking_number = v_tracking_number,
      shipped_at = coalesce(requests.shipped_at, clock_timestamp())
    where requests.id = v_request_id;
  end loop;

  return query
  select
    requests.id,
    requests.status,
    requests.courier,
    requests.tracking_number,
    requests.shipped_at,
    requests.updated_at
  from unnest(v_request_ids) with ordinality as selected(id, position)
  join public.shipping_requests as requests on requests.id = selected.id
  order by selected.position;
end;
$$;

revoke all on function public.upsert_shipping_tracking_batch(jsonb)
from public, anon;
grant execute on function public.upsert_shipping_tracking_batch(jsonb)
to authenticated;

-- Keep the original one-at-a-time API compatible while allowing a previously
-- registered tracking number to be corrected through the same validation path.
create or replace function public.mark_shipping_request_shipped(
  p_request_id uuid,
  p_courier text,
  p_tracking_number text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_at timestamptz;
begin
  if auth.uid() is null or not public.can_view_shipping_queue() then
    raise exception using errcode = '42501', message = '배송 처리 권한이 없습니다.';
  end if;

  select requests.updated_at into v_updated_at
  from public.shipping_requests as requests
  where requests.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송 요청을 찾을 수 없습니다.';
  end if;

  perform public.upsert_shipping_tracking_batch(
    jsonb_build_array(
      jsonb_build_object(
        'request_id', p_request_id,
        'courier', p_courier,
        'tracking_number', p_tracking_number,
        'expected_updated_at', v_updated_at
      )
    )
  );
  return 'shipped';
end;
$$;

revoke all on function public.mark_shipping_request_shipped(uuid, text, text)
from public, anon;
grant execute on function public.mark_shipping_request_shipped(uuid, text, text)
to authenticated;

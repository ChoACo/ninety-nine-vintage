-- Member onboarding, center administration, and staff workflow boundaries.

-- Every Kakao account chooses its nickname once. Any later change is reviewed
-- by the owner; the former unreviewed "one free change" path is retired.
update public.profiles
set nickname_self_change_used_at = coalesce(
  nickname_self_change_used_at,
  nickname_initialized_at
)
where nickname_initialized_at is not null
  and nickname_self_change_used_at is null;

create or replace function public.get_my_nickname_state()
returns table (
  display_name text,
  is_initialized boolean,
  can_change_once boolean,
  pending_request_id uuid,
  pending_nickname text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.auth_user_has_kakao_identity(auth.uid()) then
    raise exception using errcode = '42501', message = '카카오 로그인이 필요합니다.';
  end if;

  return query
  select
    profiles.display_name,
    profiles.nickname_initialized_at is not null,
    false,
    requests.id,
    requests.requested_nickname
  from public.profiles as profiles
  left join lateral (
    select pending.id, pending.requested_nickname
    from public.nickname_change_requests as pending
    where pending.member_id = profiles.id
      and pending.status = 'pending'
    order by pending.created_at desc
    limit 1
  ) as requests on true
  where profiles.id = auth.uid();
end;
$$;

revoke all on function public.get_my_nickname_state() from public, anon;
grant execute on function public.get_my_nickname_state() to authenticated;

create or replace function public.set_my_initial_nickname(p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text := public.assert_valid_member_nickname(p_nickname);
begin
  if auth.uid() is null
    or public.access_role_for_user(auth.uid())
      not in ('operator', 'employee', 'band_member', 'member')
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  update public.profiles
  set
    display_name = v_nickname,
    nickname_initialized_at = clock_timestamp(),
    nickname_self_change_used_at = clock_timestamp()
  where id = auth.uid()
    and nickname_initialized_at is null;

  if not found then
    raise exception using errcode = '23505', message = '최초 닉네임은 이미 설정되었습니다.';
  end if;
  return v_nickname;
end;
$$;

revoke all on function public.set_my_initial_nickname(text) from public, anon;
grant execute on function public.set_my_initial_nickname(text) to authenticated;

revoke all on function public.change_my_nickname_once(text)
from public, anon, authenticated, service_role;
drop function if exists public.change_my_nickname_once(text);

create or replace function public.request_my_nickname_change(p_nickname text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text := public.assert_valid_member_nickname(p_nickname);
  v_request_id uuid;
begin
  if auth.uid() is null
    or public.access_role_for_user(auth.uid())
      not in ('operator', 'employee', 'band_member', 'member')
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and nickname_initialized_at is not null
  ) then
    raise exception using errcode = '22023', message = '최초 닉네임을 먼저 설정해 주세요.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = auth.uid() and display_name = v_nickname
  ) then
    raise exception using errcode = '22023', message = '현재 닉네임과 다른 값을 입력해 주세요.';
  end if;

  insert into public.nickname_change_requests (member_id, requested_nickname)
  values (auth.uid(), v_nickname)
  on conflict (member_id) where status = 'pending'
  do update set
    requested_nickname = excluded.requested_nickname,
    created_at = clock_timestamp()
  returning id into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.request_my_nickname_change(text) from public, anon;
grant execute on function public.request_my_nickname_change(text) to authenticated;

create or replace function public.get_pending_nickname_change_requests()
returns table (
  request_id uuid,
  member_id uuid,
  current_nickname text,
  requested_nickname text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.access_role_for_user(auth.uid()) not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '닉네임 요청 조회 권한이 없습니다.';
  end if;
  return query
  select
    requests.id,
    requests.member_id,
    profiles.display_name,
    requests.requested_nickname,
    requests.created_at
  from public.nickname_change_requests as requests
  join public.profiles as profiles on profiles.id = requests.member_id
  where requests.status = 'pending'
    and public.access_role_for_user(requests.member_id)
      in ('operator', 'employee', 'band_member', 'member')
  order by requests.created_at, requests.id;
end;
$$;

revoke all on function public.get_pending_nickname_change_requests()
from public, anon;
grant execute on function public.get_pending_nickname_change_requests()
to authenticated;

create or replace function public.review_nickname_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_nickname text;
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  if public.access_role_for_user(auth.uid()) not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '닉네임 요청 처리 권한이 없습니다.';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception using errcode = '22023', message = '검토 메모는 300자 이하로 입력해 주세요.';
  end if;

  select requests.member_id, requests.requested_nickname
  into v_member_id, v_nickname
  from public.nickname_change_requests as requests
  where requests.id = p_request_id and requests.status = 'pending'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '처리할 닉네임 요청을 찾지 못했습니다.';
  end if;

  if p_approve then
    update public.profiles set display_name = v_nickname
    where id = v_member_id;
  end if;
  update public.nickname_change_requests
  set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(),
    review_note = v_note,
    reviewed_at = clock_timestamp()
  where id = p_request_id;

  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

revoke all on function public.review_nickname_change_request(uuid, boolean, text)
from public, anon;
grant execute on function public.review_nickname_change_request(uuid, boolean, text)
to authenticated;

-- Band members keep the same visible deadline, but deadline expiry never
-- creates a warning, expires the purchase right, or blocks a later payment.
alter table public.auction_purchase_offers
  add column if not exists display_payment_due_at timestamptz;
alter table public.manual_transfer_orders
  add column if not exists display_due_at timestamptz;

create or replace function app_private.sync_visible_payment_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed_at timestamptz;
begin
  if new.display_payment_due_at is null then
    select products.closes_at
    into v_closed_at
    from public.products as products
    where products.id = new.product_id;
    new.display_payment_due_at := coalesce(
      new.payment_due_at,
      new.response_due_at,
      app_private.original_manual_payment_due_at(
        coalesce(v_closed_at, new.offered_at, clock_timestamp()),
        clock_timestamp()
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.sync_visible_payment_deadline()
from public, anon, authenticated, service_role;
drop trigger if exists auction_purchase_offers_visible_deadline
on public.auction_purchase_offers;
create trigger auction_purchase_offers_visible_deadline
before insert or update of payment_due_at, response_due_at, offered_at
on public.auction_purchase_offers
for each row execute function app_private.sync_visible_payment_deadline();

update public.auction_purchase_offers
set display_payment_due_at = coalesce(
  auction_purchase_offers.payment_due_at,
  auction_purchase_offers.response_due_at,
  app_private.original_manual_payment_due_at(
    coalesce(products.closes_at, auction_purchase_offers.offered_at, clock_timestamp()),
    clock_timestamp()
  )
)
from public.products as products
where products.id = auction_purchase_offers.product_id
  and auction_purchase_offers.display_payment_due_at is null;

create or replace function app_private.sync_visible_manual_transfer_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_due_at is null then
    select coalesce(offers.display_payment_due_at, offers.payment_due_at)
    into new.display_due_at
    from public.auction_purchase_offers as offers
    where offers.id = new.purchase_offer_id;
    new.display_due_at := coalesce(new.display_due_at, new.due_at);
  end if;
  return new;
end;
$$;

revoke all on function app_private.sync_visible_manual_transfer_deadline()
from public, anon, authenticated, service_role;
drop trigger if exists manual_transfer_orders_visible_deadline
on public.manual_transfer_orders;
create trigger manual_transfer_orders_visible_deadline
before insert or update of due_at, purchase_offer_id
on public.manual_transfer_orders
for each row execute function app_private.sync_visible_manual_transfer_deadline();

update public.manual_transfer_orders as transfers
set display_due_at = coalesce(
  transfers.due_at,
  offers.display_payment_due_at,
  offers.payment_due_at
)
from public.auction_purchase_offers as offers
where offers.id = transfers.purchase_offer_id
  and transfers.display_due_at is null;

-- A manually entered band-member warning is retained, but it never causes the
-- automatic every-third-warning sanction. Explicit manual sanctions remain
-- available through manage_member_sanction().
create or replace function public.add_member_warning(
  p_member_id uuid,
  p_category text,
  p_reason text
)
returns table (
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  cancelled_bid_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_target_role text;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_warning_count integer;
  v_sanction_count integer;
  v_blocked_until timestamptz;
  v_warning_id uuid;
  v_sanction_id uuid;
  v_sanction_round integer;
  v_now timestamptz := clock_timestamp();
  v_cancelled_count integer := 0;
begin
  if v_actor_role not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '회원 경고를 등록할 권한이 없습니다.';
  end if;
  if v_category !~ '^[a-z][a-z0-9_]{1,39}$'
    or char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = '경고 분류와 사유를 확인해 주세요.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('member-warning-enforcement:' || p_member_id::text, 0)
  );
  select public.access_role_for_user(p_member_id) into v_target_role;
  if v_target_role not in ('band_member', 'member') then
    raise exception using errcode = '42501', message = '일반 회원에게만 경고를 등록할 수 있습니다.';
  end if;

  select count(*)::integer
  into v_warning_count
  from public.member_warnings
  where member_id = p_member_id;
  select count(*)::integer, max(ends_at)
  into v_sanction_count, v_blocked_until
  from public.member_bid_sanctions
  where member_id = p_member_id;

  if v_category = 'late_payment' and v_target_role = 'band_member' then
    return query select
      v_warning_count,
      v_sanction_count,
      case when v_blocked_until > v_now then v_blocked_until else null end,
      0;
    return;
  end if;

  v_warning_count := v_warning_count + 1;
  insert into public.member_warnings(
    member_id, category, reason, warning_number, created_by, created_at
  ) values (
    p_member_id, v_category, v_reason, v_warning_count, auth.uid(), v_now
  ) returning id into v_warning_id;

  if v_target_role = 'member' and mod(v_warning_count, 3) = 0 then
    v_sanction_round := v_sanction_count + 1;
    v_blocked_until := greatest(v_now, coalesce(v_blocked_until, v_now))
      + make_interval(days => v_sanction_round);
    insert into public.member_bid_sanctions(
      member_id, warning_id, sanction_round, starts_at, ends_at,
      source, reason, status, updated_by
    ) values (
      p_member_id, v_warning_id, v_sanction_round, v_now, v_blocked_until,
      'automatic', v_reason, 'active', auth.uid()
    ) returning id into v_sanction_id;
    v_cancelled_count := public.cancel_member_active_bids(
      p_member_id, v_sanction_id, v_now
    );
    v_sanction_count := v_sanction_round;
  end if;

  return query select
    v_warning_count,
    v_sanction_count,
    case when v_blocked_until > v_now then v_blocked_until else null end,
    v_cancelled_count;
end;
$$;

revoke all on function public.add_member_warning(uuid, text, text)
from public, anon;
grant execute on function public.add_member_warning(uuid, text, text)
to authenticated;

-- Owner-managed role editing preserves the explicit employee -> operator
-- relationship instead of silently selecting the first operator.
create or replace function public.set_managed_staff_role(
  p_member_id uuid,
  p_role_code text,
  p_reports_to_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := lower(btrim(coalesce(p_role_code, '')));
  v_current text;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '관리자 권한이 필요합니다.';
  end if;
  if v_role not in ('operator', 'employee', 'band_member', 'member') then
    raise exception using errcode = '22023', message = '역할을 확인해 주세요.';
  end if;
  select role_code into v_current
  from public.account_access_roles
  where user_id = p_member_id
  for update;
  if v_current is null then
    raise exception using errcode = 'P0002', message = '계정을 찾을 수 없습니다.';
  end if;
  if v_current = 'owner' then
    raise exception using errcode = '42501', message = '소유자 역할은 변경할 수 없습니다.';
  end if;
  if v_role = 'employee' and not exists (
    select 1 from public.account_access_roles
    where user_id = p_reports_to_operator_id and role_code = 'operator'
  ) then
    raise exception using errcode = '23514', message = '직원의 담당 운영자를 지정해 주세요.';
  end if;

  update public.account_access_roles
  set
    role_code = v_role,
    reports_to_operator_id = case
      when v_role = 'employee' then p_reports_to_operator_id
      else null
    end
  where user_id = p_member_id;

  if v_role not in ('operator', 'employee') then
    update public.fulfillment_center_staff_assignments
    set
      status = 'inactive',
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
    where user_id = p_member_id and status = 'active';
  end if;

  return jsonb_build_object(
    'memberId', p_member_id,
    'roleCode', v_role,
    'reportsToOperatorId',
      case when v_role = 'employee' then p_reports_to_operator_id end
  );
end;
$$;

revoke all on function public.set_managed_staff_role(uuid, text, uuid)
from public, anon;
grant execute on function public.set_managed_staff_role(uuid, text, uuid)
to authenticated;

-- Owners can maintain contact details for both operators and employees. The
-- display-name argument remains intentionally ignored because nickname changes
-- must go through the review workflow above.
create or replace function public.update_managed_member(
  p_member_id uuid,
  p_display_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 정보 수정 권한이 없습니다.';
  end if;
  select public.access_role_for_user(p_member_id) into v_role;
  if v_role not in ('operator', 'employee', 'band_member', 'member') then
    raise exception using errcode = '42501', message = '소유자 정보는 이 경로로 수정할 수 없습니다.';
  end if;
  if v_phone is not null and char_length(v_phone) not between 7 and 30 then
    raise exception using errcode = '22023', message = '연락처를 확인해 주세요.';
  end if;

  update public.member_accounts set phone = v_phone
  where member_id = p_member_id;
  if v_phone is not null then
    update public.shipping_addresses
    set phone = v_phone
    where member_id = p_member_id and is_default;
  end if;
end;
$$;

revoke all on function public.update_managed_member(uuid, text, text)
from public, anon;
grant execute on function public.update_managed_member(uuid, text, text)
to authenticated;

-- Center assignment is also the catalog boundary for operators. Employees
-- keep parcel/fulfillment permissions but never inherit product management.
create or replace function public.has_store_permission(
  p_store_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists(
    select 1
    from public.stores as stores
    join public.businesses as businesses
      on businesses.id = stores.business_id and businesses.status = 'active'
    where stores.id = p_store_id
      and stores.is_active
      and (
        public.is_owner()
        or exists (
          select 1
          from public.store_memberships as memberships
          where memberships.store_id = stores.id
            and memberships.business_id = stores.business_id
            and memberships.user_id = auth.uid()
            and memberships.status = 'active'
            and case lower(btrim(coalesce(p_permission, '')))
              when 'manage_products' then memberships.manage_products
              when 'publish_products' then memberships.publish_products
              when 'prepare_orders' then memberships.prepare_orders
              when 'confirm_payments' then memberships.confirm_payments
              when 'receive_at_center' then memberships.receive_at_center
              when 'create_shipments' then memberships.create_shipments
              when 'manage_staff' then memberships.manage_staff
              when 'view_reports' then memberships.view_reports
              else false
            end
        )
        or (
          public.access_role_for_user(auth.uid()) = 'operator'
          and lower(btrim(coalesce(p_permission, '')))
            in ('manage_products', 'publish_products', 'prepare_orders', 'view_reports')
          and stores.home_fulfillment_center_id is not null
          and exists (
            select 1
            from public.fulfillment_center_staff_assignments as assignments
            join public.fulfillment_centers as centers
              on centers.id = assignments.fulfillment_center_id
              and centers.status = 'active'
            where assignments.fulfillment_center_id =
              stores.home_fulfillment_center_id
              and assignments.user_id = auth.uid()
              and assignments.status = 'active'
          )
        )
        or (
          lower(btrim(coalesce(p_permission, ''))) = 'prepare_orders'
          and stores.home_fulfillment_center_id is not null
          and exists (
            select 1
            from public.fulfillment_center_staff_assignments as assignments
            join public.fulfillment_centers as centers
              on centers.id = assignments.fulfillment_center_id
              and centers.status = 'active'
            where assignments.fulfillment_center_id =
              stores.home_fulfillment_center_id
              and assignments.user_id = auth.uid()
              and assignments.status = 'active'
              and assignments.create_shipments
          )
        )
      )
  ), false);
$$;

revoke all on function public.has_store_permission(uuid, text)
from public, anon;
grant execute on function public.has_store_permission(uuid, text)
to authenticated;

create or replace function public.get_my_center_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.access_role_for_user(auth.uid());
  v_result jsonb;
begin
  if v_role not in ('owner', 'operator', 'employee') then
    raise exception using errcode = '42501', message = '센터 조회 권한이 없습니다.';
  end if;
  select jsonb_build_object(
    'roleCode', v_role,
    'centers', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.name, rows.id)
      from (
        select
          centers.id,
          centers.business_id,
          centers.code,
          centers.name,
          centers.status,
          centers.is_default,
          centers.postal_code,
          centers.address_line1,
          centers.address_line2,
          centers.contact_name,
          centers.contact_phone,
          centers.version,
          centers.updated_at,
          assignments.receive_at_center,
          assignments.create_shipments
        from public.fulfillment_centers as centers
        left join public.fulfillment_center_staff_assignments as assignments
          on assignments.fulfillment_center_id = centers.id
          and assignments.user_id = auth.uid()
          and assignments.status = 'active'
        where centers.status <> 'archived'
          and (
            v_role = 'owner'
            or assignments.id is not null
          )
      ) as rows
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.name, rows.id)
      from (
        select
          stores.id,
          stores.business_id,
          stores.name,
          stores.slug,
          stores.home_fulfillment_center_id,
          stores.is_active
        from public.stores as stores
        where stores.is_active
          and (
            v_role = 'owner'
            or exists (
              select 1
              from public.fulfillment_center_staff_assignments as assignments
              where assignments.user_id = auth.uid()
                and assignments.status = 'active'
                and assignments.fulfillment_center_id =
                  stores.home_fulfillment_center_id
            )
          )
      ) as rows
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_my_center_management()
from public, anon;
grant execute on function public.get_my_center_management()
to authenticated;

create or replace function public.configure_assigned_fulfillment_center(
  p_action text,
  p_center_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_postal_code text,
  p_address_line1 text,
  p_address_line2 text,
  p_contact_name text,
  p_contact_phone text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.access_role_for_user(v_actor);
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_center public.fulfillment_centers%rowtype;
  v_business uuid;
begin
  if v_role not in ('operator', 'employee') then
    raise exception using errcode = '42501', message = '센터 관리 권한이 없습니다.';
  end if;
  if v_action not in ('create', 'update', 'archive') then
    raise exception using errcode = '22023', message = '센터 작업을 확인해 주세요.';
  end if;
  if v_role = 'employee' and v_action <> 'update' then
    raise exception using errcode = '42501', message = '직원은 배정 센터 정보만 수정할 수 있습니다.';
  end if;
  if btrim(coalesce(p_code, '')) !~ '^[a-z0-9-]{2,80}$'
    or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
  then
    raise exception using errcode = '22023', message = '센터 코드와 이름을 확인해 주세요.';
  end if;

  if v_action = 'create' then
    select assignments.business_id
    into v_business
    from public.fulfillment_center_staff_assignments as assignments
    where assignments.user_id = v_actor and assignments.status = 'active'
    order by assignments.updated_at desc, assignments.id
    limit 1;
    if v_business is null then
      select memberships.business_id
      into v_business
      from public.store_memberships as memberships
      where memberships.user_id = v_actor
        and memberships.status = 'active'
        and memberships.manage_staff
      order by memberships.updated_at desc, memberships.id
      limit 1;
    end if;
    if v_business is null then
      raise exception using errcode = '42501', message = '센터를 추가할 사업자 배정이 없습니다.';
    end if;
    insert into public.fulfillment_centers(
      business_id, code, name, status, is_default,
      postal_code, address_line1, address_line2,
      contact_name, contact_phone, created_by, updated_by
    ) values (
      v_business, btrim(p_code), btrim(p_name), 'active',
      coalesce(p_is_default, false),
      nullif(btrim(coalesce(p_postal_code, '')), ''),
      nullif(btrim(coalesce(p_address_line1, '')), ''),
      nullif(btrim(coalesce(p_address_line2, '')), ''),
      nullif(btrim(coalesce(p_contact_name, '')), ''),
      nullif(btrim(coalesce(p_contact_phone, '')), ''),
      v_actor, v_actor
    ) returning * into v_center;
    insert into public.fulfillment_center_staff_assignments(
      business_id, fulfillment_center_id, user_id, status,
      receive_at_center, create_shipments, created_by, updated_by
    ) values (
      v_business, v_center.id, v_actor, 'active', true, true, v_actor, v_actor
    );
  else
    select centers.*
    into v_center
    from public.fulfillment_centers as centers
    where centers.id = p_center_id
      and exists (
        select 1
        from public.fulfillment_center_staff_assignments as assignments
        where assignments.fulfillment_center_id = centers.id
          and assignments.user_id = v_actor
          and assignments.status = 'active'
      )
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = '배정된 센터를 찾을 수 없습니다.';
    end if;
    if v_center.version is distinct from p_expected_version then
      raise exception using errcode = 'PT409', message = '센터 정보가 변경되었습니다.';
    end if;

    if v_action = 'update' then
      update public.fulfillment_centers
      set
        code = btrim(p_code),
        name = btrim(p_name),
        is_default = coalesce(p_is_default, is_default),
        postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
        address_line1 = nullif(btrim(coalesce(p_address_line1, '')), ''),
        address_line2 = nullif(btrim(coalesce(p_address_line2, '')), ''),
        contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
        contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
        version = version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
      where id = v_center.id
      returning * into v_center;
    else
      if exists (
        select 1 from public.inventory_item_fulfillments
        where fulfillment_center_id = v_center.id
          and current_stage not in ('shipped', 'cancelled')
      ) then
        raise exception using errcode = '55000', message = '진행 중인 물류 상품이 있는 센터는 삭제할 수 없습니다.';
      end if;
      update public.fulfillment_centers
      set
        status = 'archived',
        is_default = false,
        version = version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
      where id = v_center.id
      returning * into v_center;
      update public.fulfillment_center_staff_assignments
      set
        status = 'inactive',
        version = version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
      where fulfillment_center_id = v_center.id and status = 'active';
      update public.stores
      set home_fulfillment_center_id = null
      where home_fulfillment_center_id = v_center.id;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_center.id,
    'businessId', v_center.business_id,
    'code', v_center.code,
    'name', v_center.name,
    'status', v_center.status,
    'isDefault', v_center.is_default,
    'version', v_center.version
  );
end;
$$;

revoke all on function public.configure_assigned_fulfillment_center(
  text, uuid, text, text, boolean, text, text, text, text, text, bigint
) from public, anon;
grant execute on function public.configure_assigned_fulfillment_center(
  text, uuid, text, text, boolean, text, text, text, text, text, bigint
) to authenticated;

create or replace function public.pause_managed_product(
  p_product_id uuid,
  p_expected_updated_at timestamptz
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;
  if not public.has_store_permission(v_product.store_id, 'manage_products') then
    raise exception using errcode = '42501', message = '상품 관리 권한이 없습니다.';
  end if;
  if v_product.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = '상품 정보가 변경되었습니다.';
  end if;
  if v_product.status <> 'active' then
    raise exception using errcode = '55000', message = '공개 중인 상품만 일시중지할 수 있습니다.';
  end if;
  if v_product.participant_count <> 0
    or v_product.final_bid_id is not null
    or exists (
      select 1 from public.auction_bids where product_id = p_product_id
    )
  then
    raise exception using errcode = '55000', message = '입찰 기록이 있는 상품은 일시중지할 수 없습니다.';
  end if;

  update public.products
  set status = 'pending', updated_by = auth.uid()
  where id = p_product_id;
  return query select * from public.products where id = p_product_id;
end;
$$;

revoke all on function public.pause_managed_product(uuid, timestamptz)
from public, anon;
grant execute on function public.pause_managed_product(uuid, timestamptz)
to authenticated;

create or replace function public.set_site_status(
  p_status text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.site_status%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_message text := btrim(coalesce(p_message, ''));
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '관리자 권한이 필요합니다.';
  end if;
  if v_status not in ('operational', 'maintenance', 'preparing')
    or char_length(v_message) > 500 then
    raise exception using errcode = '22023', message = '사이트 상태를 확인해 주세요.';
  end if;
  insert into public.site_status(singleton, status, message, updated_by, updated_at)
  values(true, v_status, v_message, auth.uid(), clock_timestamp())
  on conflict(singleton) do update set
    status = excluded.status,
    message = excluded.message,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into v_row;
  return jsonb_build_object(
    'status', v_row.status,
    'message', v_row.message,
    'updatedAt', v_row.updated_at,
    'updatedBy', v_row.updated_by
  );
end;
$$;

revoke all on function public.set_site_status(text, text)
from public, anon;
grant execute on function public.set_site_status(text, text)
to authenticated;

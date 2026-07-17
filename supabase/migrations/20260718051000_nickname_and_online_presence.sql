-- Member-chosen nicknames and an exact, role-aware online directory.
-- Kakao profile refreshes may update avatars, but must never overwrite a
-- nickname that the member chose inside the service.

alter table public.profiles
  add column if not exists nickname_initialized_at timestamptz,
  add column if not exists nickname_self_change_used_at timestamptz;

update public.profiles as profiles
set nickname_initialized_at = coalesce(
  profiles.nickname_initialized_at,
  profiles.created_at
)
where profiles.nickname_initialized_at is null
  and profiles.display_name !~* '^회원-[0-9a-f]{6}$';

create or replace function public.normalize_member_nickname(p_nickname text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p_nickname, ''), '[[:space:]]+', ' ', 'g'));
$$;

revoke all on function public.normalize_member_nickname(text) from public;

create or replace function public.assert_valid_member_nickname(p_nickname text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nickname text := public.normalize_member_nickname(p_nickname);
begin
  if char_length(v_nickname) not between 2 and 20 then
    raise exception using
      errcode = '22023',
      message = '닉네임은 공백을 제외하고 2자 이상 20자 이하로 입력해 주세요.';
  end if;

  if v_nickname ~ '[[:cntrl:]]'
    or v_nickname ~* '^회원-[0-9a-f]{6,}$'
    or replace(lower(v_nickname), ' ', '') in (
      '관리자', '운영자', '직원', 'admin', 'administrator', 'operator', 'staff'
    )
  then
    raise exception using
      errcode = '22023',
      message = '서비스 직책이나 자동 식별자와 혼동될 수 있는 닉네임은 사용할 수 없습니다.';
  end if;

  return v_nickname;
end;
$$;

revoke all on function public.assert_valid_member_nickname(text) from public;

create table if not exists public.nickname_change_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  requested_nickname text not null
    check (char_length(btrim(requested_nickname)) between 2 and 20),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_note text
    check (review_note is null or char_length(btrim(review_note)) <= 300),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index if not exists nickname_change_requests_one_pending_idx
  on public.nickname_change_requests (member_id)
  where status = 'pending';
create index if not exists nickname_change_requests_staff_queue_idx
  on public.nickname_change_requests (status, created_at, id);

alter table public.nickname_change_requests enable row level security;
revoke all on public.nickname_change_requests from anon, authenticated;

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_avatar_url text;
begin
  v_display_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'preferred_username'), ''),
      '회원-' || left(new.id::text, 6)
    ),
    80
  );
  v_avatar_url := nullif(
    left(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'avatar_url',
          new.raw_user_meta_data ->> 'picture',
          ''
        )
      ),
      2048
    ),
    ''
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_display_name, v_avatar_url)
  on conflict (id) do update
  set avatar_url = excluded.avatar_url;

  return new;
end;
$$;

revoke all on function public.sync_auth_user_profile() from public;

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
    profiles.nickname_initialized_at is not null
      and profiles.nickname_self_change_used_at is null,
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

revoke all on function public.get_my_nickname_state() from public;
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
    or public.access_role_for_user(auth.uid()) not in ('member', 'band_member')
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;

  update public.profiles
  set
    display_name = v_nickname,
    nickname_initialized_at = clock_timestamp()
  where id = auth.uid()
    and nickname_initialized_at is null;

  if not found then
    raise exception using errcode = '23505', message = '최초 닉네임은 이미 설정되었습니다.';
  end if;

  return v_nickname;
end;
$$;

revoke all on function public.set_my_initial_nickname(text) from public;
grant execute on function public.set_my_initial_nickname(text) to authenticated;

create or replace function public.change_my_nickname_once(p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text := public.assert_valid_member_nickname(p_nickname);
begin
  if auth.uid() is null
    or public.access_role_for_user(auth.uid()) not in ('member', 'band_member')
  then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;

  update public.profiles
  set
    display_name = v_nickname,
    nickname_self_change_used_at = clock_timestamp()
  where id = auth.uid()
    and nickname_initialized_at is not null
    and nickname_self_change_used_at is null;

  if not found then
    raise exception using
      errcode = '42501',
      message = '직접 변경 기회를 이미 사용했습니다. 운영자 승인 요청을 이용해 주세요.';
  end if;

  update public.nickname_change_requests
  set status = 'cancelled', reviewed_at = clock_timestamp()
  where member_id = auth.uid() and status = 'pending';

  return v_nickname;
end;
$$;

revoke all on function public.change_my_nickname_once(text) from public;
grant execute on function public.change_my_nickname_once(text) to authenticated;

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
    or public.access_role_for_user(auth.uid()) not in ('member', 'band_member')
  then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and nickname_initialized_at is not null
      and nickname_self_change_used_at is not null
  ) then
    raise exception using
      errcode = '22023',
      message = '먼저 남아 있는 1회 직접 변경 기회를 이용해 주세요.';
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

revoke all on function public.request_my_nickname_change(text) from public;
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
  if not public.can_manage_members() then
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
    and public.access_role_for_user(requests.member_id) in ('employee', 'band_member', 'member')
  order by requests.created_at, requests.id;
end;
$$;

revoke all on function public.get_pending_nickname_change_requests() from public;
grant execute on function public.get_pending_nickname_change_requests() to authenticated;

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
  if not public.can_manage_members() then
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
    update public.profiles set display_name = v_nickname where id = v_member_id;
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

revoke all on function public.review_nickname_change_request(uuid, boolean, text) from public;
grant execute on function public.review_nickname_change_request(uuid, boolean, text)
  to authenticated;

-- Keep legacy member editing for contact details, but prohibit direct staff
-- overwrite of a member-chosen nickname. Nicknames now follow the review flow.
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
  if v_role not in ('employee', 'band_member', 'member') then
    raise exception using errcode = '42501', message = '운영 계정 정보는 이 경로로 수정할 수 없습니다.';
  end if;
  if v_phone is not null and char_length(v_phone) not between 7 and 30 then
    raise exception using errcode = '22023', message = '연락처를 확인해 주세요.';
  end if;

  update public.member_accounts set phone = v_phone where member_id = p_member_id;
  if v_phone is not null then
    update public.shipping_addresses
    set phone = v_phone
    where member_id = p_member_id and is_default;
  end if;
end;
$$;

revoke all on function public.update_managed_member(uuid, text, text) from public;
grant execute on function public.update_managed_member(uuid, text, text) to authenticated;

drop function if exists public.get_online_member_directory(integer);

create function public.get_online_member_directory(
  p_limit integer default 50
)
returns table (
  id uuid,
  display_name text,
  is_operator boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.auth_user_has_kakao_identity(auth.uid())
  then
    raise exception using errcode = '42501', message = '카카오 로그인이 필요합니다.';
  end if;

  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = '온라인 회원 조회 범위를 확인해 주세요.';
  end if;

  return query
  with online as (
    select
      profiles.id,
      profiles.display_name,
      roles.role_code = 'operator' as is_operator
    from public.account_last_seen as last_seen
    join public.account_access_roles as roles on roles.user_id = last_seen.user_id
    join public.profiles as profiles on profiles.id = last_seen.user_id
    where last_seen.last_seen_at >= statement_timestamp() - interval '75 seconds'
      and roles.role_code in ('operator', 'band_member', 'member')
      and profiles.nickname_initialized_at is not null
      and public.auth_user_has_kakao_identity(last_seen.user_id)
  )
  select
    online.id,
    online.display_name,
    online.is_operator,
    count(*) over () as total_count
  from online
  order by online.is_operator desc, online.display_name, online.id
  limit p_limit;
end;
$$;

revoke all on function public.get_online_member_directory(integer) from public;
grant execute on function public.get_online_member_directory(integer) to authenticated;

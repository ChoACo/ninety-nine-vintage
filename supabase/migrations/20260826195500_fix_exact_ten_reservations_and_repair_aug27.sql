begin;

-- An exact 10:00 KST slot is already a valid drop boundary. The legacy
-- strict-less-than comparison incorrectly moved it to 10:00 on the next day.
create or replace function public.next_auction_drop_at(p_at timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_date date := (p_at at time zone 'Asia/Seoul')::date;
  v_time time := (p_at at time zone 'Asia/Seoul')::time;
begin
  if p_at is null then
    raise exception using
      errcode = '22023',
      message = '경매 등록 기준 시각이 필요합니다.';
  end if;
  return (
    v_date + case when v_time <= time '10:00:00' then 0 else 1 end
    + time '10:00:00'
  ) at time zone 'Asia/Seoul';
end;
$$;

revoke all on function public.next_auction_drop_at(timestamptz) from public;

create table app_private.scheduled_publication_repair_20260827_backup (
  product_id uuid primary key references public.products(id) on delete restrict,
  original_publish_at timestamptz not null,
  original_closes_at timestamptz not null,
  original_auction_feed_expires_at timestamptz,
  original_paused_at timestamptz,
  original_updated_at timestamptz not null,
  backed_up_at timestamptz not null default clock_timestamp()
);

revoke all on table app_private.scheduled_publication_repair_20260827_backup
from public, anon, authenticated, service_role;

lock table public.products in share row exclusive mode;

insert into app_private.scheduled_publication_repair_20260827_backup (
  product_id,
  original_publish_at,
  original_closes_at,
  original_auction_feed_expires_at,
  original_paused_at,
  original_updated_at
)
select
  products.id,
  products.publish_at,
  products.closes_at,
  products.auction_feed_expires_at,
  products.paused_at,
  products.updated_at
from public.products as products
where products.status = 'pending'
  and products.sale_type = 'auction'
  and products.publish_at = timestamptz '2026-08-28 10:00:00 Asia/Seoul';

update public.products as products
set publish_at = timestamptz '2026-08-27 10:00:00 Asia/Seoul'
where products.id in (
  select backup.product_id
  from app_private.scheduled_publication_repair_20260827_backup as backup
);

do $$
declare
  v_backup_count integer;
  v_repaired_count integer;
begin
  select count(*)
  into v_backup_count
  from app_private.scheduled_publication_repair_20260827_backup;

  select count(*)
  into v_repaired_count
  from public.products as products
  join app_private.scheduled_publication_repair_20260827_backup as backup
    on backup.product_id = products.id
  where products.publish_at =
    timestamptz '2026-08-27 10:00:00 Asia/Seoul';

  if v_repaired_count <> v_backup_count then
    raise exception using
      errcode = 'P0001',
      message = format(
        '예약 공개 보정 검증 실패: 백업 %s건, 보정 %s건',
        v_backup_count,
        v_repaired_count
      );
  end if;
end;
$$;

commit;

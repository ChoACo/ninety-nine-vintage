begin;

alter table public.stores
  add column if not exists announcement_text text,
  add column if not exists announcement_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.stores'::regclass
      and conname = 'stores_announcement_text_length_check'
  ) then
    alter table public.stores
      add constraint stores_announcement_text_length_check
      check (announcement_text is null or char_length(announcement_text) <= 80);
  end if;
end;
$$;

grant select (announcement_text, announcement_enabled)
on table public.stores to anon, authenticated;

create or replace function public.save_operator_store_notice(
  p_store_id uuid,
  p_announcement_text text,
  p_announcement_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_announcement_text, '')), '');
begin
  if v_actor is null or not (
    public.is_owner() or public.has_store_permission(p_store_id, 'manage_store')
  ) then
    raise exception using errcode = '42501', message = '매장 공지 설정 권한이 없습니다.';
  end if;
  if char_length(coalesce(v_text, '')) > 80 or (p_announcement_enabled and v_text is null) then
    raise exception using errcode = '22023', message = '매장 공지 입력값을 확인해 주세요.';
  end if;
  update public.stores
  set announcement_text = v_text,
      announcement_enabled = coalesce(p_announcement_enabled, false),
      updated_at = clock_timestamp()
  where id = p_store_id and is_active;
  if not found then
    raise exception using errcode = 'P0002', message = '설정할 센터를 찾지 못했습니다.';
  end if;
  return jsonb_build_object('storeId', p_store_id, 'updatedAt', clock_timestamp());
end;
$$;

revoke all on function public.save_operator_store_notice(uuid, text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.save_operator_store_notice(uuid, text, boolean)
to authenticated;

commit;

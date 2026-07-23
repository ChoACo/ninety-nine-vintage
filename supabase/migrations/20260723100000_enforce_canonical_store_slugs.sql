-- Preserve the two cutover stores while making their public URLs deterministic.
-- The initial cutover selected an existing store by display name, so a legacy
-- operator slug could survive even though the canonical store was active.
do $$
declare
  v_ninety_store uuid;
  v_dami_store uuid;
  v_conflict uuid;
begin
  select id
  into strict v_ninety_store
  from public.stores
  where is_active and name = '나인티 나인 빈티지';

  select id
  into strict v_dami_store
  from public.stores
  where is_active and name = '다미네 옷가게';

  select id
  into v_conflict
  from public.stores
  where slug = 'ninety-nine-vintage'
    and id <> v_ninety_store
  limit 1;

  if v_conflict is not null then
    update public.stores
    set slug = 'archived-' || replace(v_conflict::text, '-', ''),
        is_active = false,
        updated_at = clock_timestamp()
    where id = v_conflict;
  end if;

  select id
  into v_conflict
  from public.stores
  where slug = 'dami-clothing-shop-b'
    and id <> v_dami_store
  limit 1;

  if v_conflict is not null then
    update public.stores
    set slug = 'archived-' || replace(v_conflict::text, '-', ''),
        is_active = false,
        updated_at = clock_timestamp()
    where id = v_conflict;
  end if;

  update public.stores
  set slug = 'ninety-nine-vintage',
      updated_at = clock_timestamp()
  where id = v_ninety_store;

  update public.stores
  set slug = 'dami-clothing-shop-b',
      updated_at = clock_timestamp()
  where id = v_dami_store;
end;
$$;

notify pgrst, 'reload schema';

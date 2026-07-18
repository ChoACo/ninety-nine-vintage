-- Require a normalized postal code at every new member-address mutation
-- boundary without rewriting legacy rows that predate the postal_code column.
-- The owner's hidden test member remains exempt so its intentionally minimal
-- proxy-only shipping workflow keeps working until that fixture is retired.

create or replace function public.enforce_member_shipping_address_postal_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal_code text;
begin
  if exists (
    select 1
    from public.owner_hidden_test_members as hidden_test
    where hidden_test.test_user_id = new.member_id
      and hidden_test.retired_at is null
  ) then
    return new;
  end if;

  v_postal_code := btrim(coalesce(new.postal_code, ''));
  if v_postal_code !~ '^[0-9]{5}$' then
    raise exception using
      errcode = '22023',
      message = '우편번호는 숫자 5자리로 입력해 주세요.';
  end if;

  new.postal_code := v_postal_code;
  return new;
end;
$$;

revoke all on function public.enforce_member_shipping_address_postal_code()
from public, anon, authenticated, service_role;

drop trigger if exists shipping_addresses_validate_postal_code
on public.shipping_addresses;
create trigger shipping_addresses_validate_postal_code
before insert or update on public.shipping_addresses
for each row execute function public.enforce_member_shipping_address_postal_code();

create or replace function public.enforce_member_shipping_request_postal_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal_code text;
begin
  if exists (
    select 1
    from public.owner_hidden_test_members as hidden_test
    where hidden_test.test_user_id = new.member_id
      and hidden_test.retired_at is null
  ) then
    return new;
  end if;

  v_postal_code := btrim(coalesce(new.address_snapshot ->> 'postalCode', ''));
  if v_postal_code !~ '^[0-9]{5}$' then
    raise exception using
      errcode = '22023',
      message = '택배 접수에는 숫자 5자리 우편번호가 필요합니다.';
  end if;

  new.address_snapshot := jsonb_set(
    new.address_snapshot,
    '{postalCode}',
    to_jsonb(v_postal_code),
    true
  );
  return new;
end;
$$;

revoke all on function public.enforce_member_shipping_request_postal_code()
from public, anon, authenticated, service_role;

-- PostgreSQL runs triggers for the same event in name order. "set" sorts
-- before "validate", so shipping_requests_set_postal_snapshot from migration
-- 73000 gets the first opportunity to copy the saved address postal code.
drop trigger if exists shipping_requests_validate_postal_snapshot
on public.shipping_requests;
create trigger shipping_requests_validate_postal_snapshot
before insert on public.shipping_requests
for each row execute function public.enforce_member_shipping_request_postal_code();

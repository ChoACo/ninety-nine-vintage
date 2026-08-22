begin;

create table public.store_enterprise_profiles (
  store_id uuid primary key references public.stores(id) on delete restrict,
  representative_name text not null check (char_length(btrim(representative_name)) between 1 and 80),
  business_registration_number text not null check (business_registration_number ~ '^[0-9]{10}$'),
  commission_rate numeric(5,4) not null default 0.05 check (commission_rate between 0 and 0.5),
  small_storage_days integer not null default 14 check (small_storage_days between 1 and 90),
  large_storage_days integer not null default 7 check (large_storage_days between 1 and 90),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_registration_number)
);

alter table public.store_enterprise_profiles enable row level security;
alter table public.store_enterprise_profiles force row level security;
revoke all on table public.store_enterprise_profiles from public, anon, authenticated, service_role;
grant select on table public.store_enterprise_profiles to authenticated;
create policy "Owners read store enterprise profiles"
on public.store_enterprise_profiles for select to authenticated
using ((select public.is_owner()));

create or replace function app_private.store_commission_rate(p_store_id uuid,p_at timestamptz)
returns numeric language sql stable security definer set search_path='' as $$
  select coalesce(
    (select profiles.commission_rate from public.store_enterprise_profiles profiles where profiles.store_id=p_store_id),
    case when exists(
      select 1 from public.store_service_subscriptions subscriptions
      where subscriptions.store_id=p_store_id and subscriptions.plan_code='pro'
        and subscriptions.status='active' and subscriptions.started_at<=p_at
    ) then 0.035::numeric else 0.05::numeric end
  )
$$;
revoke all on function app_private.store_commission_rate(uuid,timestamptz)
from public,anon,authenticated,service_role;

create function public.owner_onboard_store(
  p_business_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_operator_id uuid,
  p_representative_name text,
  p_business_registration_number text,
  p_bank_name text,
  p_account_holder text,
  p_account_number_ciphertext text,
  p_account_number_masked text,
  p_commission_rate numeric,
  p_small_storage_days integer,
  p_large_storage_days integer,
  p_idempotency_key uuid,
  p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_store_result jsonb;
  v_store_id uuid;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if char_length(btrim(coalesce(p_representative_name,''))) not between 1 and 80
    or regexp_replace(coalesce(p_business_registration_number,''),'[^0-9]','','g') !~ '^[0-9]{10}$'
    or p_commission_rate not between 0 and 0.5
    or p_small_storage_days not between 1 and 90 or p_large_storage_days not between 1 and 90
    or char_length(coalesce(p_account_number_ciphertext,'')) < 16
  then raise exception using errcode='22023',message='센터 사업자·정산·정책 정보를 확인해 주세요.'; end if;

  v_store_result:=public.manage_owner_store('create',null,p_business_id,p_slug,p_name,p_description,
    p_operator_id,null,p_idempotency_key,p_reason);
  v_store_id:=(v_store_result->'store'->>'id')::uuid;

  insert into public.store_enterprise_profiles(store_id,representative_name,business_registration_number,
    commission_rate,small_storage_days,large_storage_days,created_by)
  values(v_store_id,btrim(p_representative_name),regexp_replace(p_business_registration_number,'[^0-9]','','g'),
    p_commission_rate,p_small_storage_days,p_large_storage_days,v_actor);

  insert into public.store_payout_accounts(store_id,bank_name,account_holder,account_number_ciphertext,
    account_number_masked,status,submitted_by)
  values(v_store_id,btrim(p_bank_name),btrim(p_account_holder),p_account_number_ciphertext,
    p_account_number_masked,'pending',v_actor);

  perform app_private.write_security_activity(v_actor,p_operator_id,'store','store.onboarded','create',
    'owner_onboard_store','store',v_store_id::text,'notice',null,null,
    jsonb_build_object('commissionRate',p_commission_rate,'smallStorageDays',p_small_storage_days,
      'largeStorageDays',p_large_storage_days,'businessRegistrationNumberMasked','***-**-'||right(regexp_replace(p_business_registration_number,'[^0-9]','','g'),5)));
  return v_store_result||jsonb_build_object('enterpriseProfileCreated',true,'payoutAccountStatus','pending');
end $$;
revoke all on function public.owner_onboard_store(uuid,text,text,text,uuid,text,text,text,text,text,text,numeric,integer,integer,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.owner_onboard_store(uuid,text,text,text,uuid,text,text,text,text,text,text,numeric,integer,integer,uuid,text)
to authenticated;

create function public.owner_confirm_manual_payment_with_note(
  p_payment_kind text,p_payment_id uuid,p_expected_version bigint,p_depositor_name text,
  p_observed_received_amount bigint,p_observed_ledger_entry_count integer,p_idempotency_key uuid,p_approval_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if char_length(btrim(coalesce(p_approval_note,''))) not between 3 and 500 then
    raise exception using errcode='22023',message='입금 승인 메모를 3자 이상 입력해 주세요.';
  end if;
  v_result:=public.confirm_unified_manual_payment_v2(p_payment_kind,p_payment_id,p_expected_version,
    p_depositor_name,p_observed_received_amount,p_observed_ledger_entry_count,p_idempotency_key);
  if coalesce((v_result->>'idempotent_replay')::boolean,false)=false then
    perform app_private.write_security_activity(v_actor,null,'payment','manual_deposit_approval','approve',
      'owner_confirm_manual_payment_with_note',p_payment_kind,p_payment_id::text,'notice',null,null,
      jsonb_build_object('admin_id',v_actor,'order_id',p_payment_id,'amount',
        coalesce((v_result->>'received_amount')::bigint,p_observed_received_amount),'reason',btrim(p_approval_note),'timestamp',clock_timestamp()));
  end if;
  return v_result;
end $$;
revoke all on function public.owner_confirm_manual_payment_with_note(text,uuid,bigint,text,bigint,integer,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.owner_confirm_manual_payment_with_note(text,uuid,bigint,text,bigint,integer,uuid,text)
to authenticated;

create function public.owner_apply_bid_penalty(p_member_id uuid,p_duration text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ends_at timestamptz; v_result jsonb;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if p_duration='3d' then v_ends_at:=clock_timestamp()+interval '3 days';
  elsif p_duration='7d' then v_ends_at:=clock_timestamp()+interval '7 days';
  elsif p_duration='permanent' then v_ends_at:='9999-12-31 23:59:59+00'::timestamptz;
  else raise exception using errcode='22023',message='제재 기간을 확인해 주세요.'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='제재 사유를 3자 이상 입력해 주세요.'; end if;
  v_result:=public.manage_member_sanction('create',p_member_id,null,clock_timestamp(),v_ends_at,p_reason);
  perform app_private.write_security_activity(auth.uid(),p_member_id,'sanction','bid_penalty.applied','create',
    'owner_apply_bid_penalty','member',p_member_id::text,'warning',null,null,
    jsonb_build_object('duration',p_duration,'reason',btrim(p_reason),'sanctionId',v_result->>'id'));
  return v_result||jsonb_build_object('duration',p_duration);
end $$;
revoke all on function public.owner_apply_bid_penalty(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.owner_apply_bid_penalty(uuid,text,text) to authenticated;

commit;

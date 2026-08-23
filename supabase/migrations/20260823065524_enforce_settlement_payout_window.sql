begin;

create or replace function public.complete_owner_settlement_batch(
  p_batch_id uuid,p_transfer_reference text,p_expected_version bigint,p_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_batch public.store_settlement_batches%rowtype;
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_window_end timestamptz;
begin
  if not public.is_owner() then
    raise exception using errcode='42501',message='소유자 권한이 필요합니다.';
  end if;
  if nullif(btrim(p_transfer_reference),'') is null or char_length(p_transfer_reference)>160
    or nullif(btrim(p_reason),'') is null or char_length(p_reason)>500 then
    raise exception using errcode='22023',message='송금 참조번호와 완료 사유를 확인해 주세요.';
  end if;

  select * into v_batch
  from public.store_settlement_batches
  where id=p_batch_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='정산 배치를 찾을 수 없습니다.';
  end if;

  v_window_start := (v_batch.settlement_date::text || ' 18:00:00 Asia/Seoul')::timestamptz;
  v_window_end := (v_batch.settlement_date::text || ' 21:00:00 Asia/Seoul')::timestamptz;
  if v_now < v_window_start or v_now >= v_window_end then
    raise exception using errcode='22023',message='정산 송금 가능 시간은 오후 6시부터 오후 9시까지입니다.';
  end if;

  update public.store_settlement_batches set status='paid',transfer_reference=btrim(p_transfer_reference),
    paid_by=auth.uid(),paid_at=v_now,version=version+1,updated_at=v_now
  where id=p_batch_id and status='draft' and version=p_expected_version
  returning * into v_batch;
  if not found then
    raise exception using errcode='40001',message='정산 배치 상태가 변경되었습니다.';
  end if;

  insert into public.notifications(member_id,audience_role,kind,title,body,href)
  select memberships.user_id,'operator','OWNER_SETTLEMENT_REQUEST','센터 정산 송금이 완료되었습니다.',
    format('%s원 정산 송금이 완료되었습니다.',v_batch.payout_amount),'/admin/operator/platform'
  from public.store_memberships memberships where memberships.store_id=v_batch.store_id
    and memberships.status='active' and memberships.membership_role in ('operator','employee');
  insert into public.store_payout_account_access_events(store_id,actor_user_id,reason)
  values(v_batch.store_id,auth.uid(),left(format('%s / batch=%s / amount=%s / ref=%s',btrim(p_reason),
    v_batch.id,v_batch.payout_amount,btrim(p_transfer_reference)),200));
  return jsonb_build_object('id',v_batch.id,'status',v_batch.status,'paidAt',v_batch.paid_at,'version',v_batch.version);
end; $$;

revoke all on function public.complete_owner_settlement_batch(uuid,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_owner_settlement_batch(uuid,text,bigint,text) to authenticated;

commit;

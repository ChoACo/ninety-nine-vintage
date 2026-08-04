begin;

-- 멀티 프로바이더 스토리지/DB 풀의 중앙 위치 메타데이터 저장소입니다.
-- 실물 객체는 storage_provider_id/storage_key로, DB 레코드는 db_provider_id로
-- 찾아가며, 서비스 스토리지/DB에서 정리된 뒤에도 locator는 삭제 시점까지 유지됩니다.
create table if not exists public.multi_provider_records (
  id uuid primary key,
  storage_provider_id text not null,
  storage_key text not null,
  db_provider_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null
);

create index if not exists multi_provider_records_expiry_idx
  on public.multi_provider_records (expires_at);

-- 이 메타데이터는 서버 전용 연결로만 접근합니다. 브라우저/클라이언트 키로는
-- 읽기조차 차단해 실제 객체 위치를 외부에 노출하지 않습니다.
revoke all on table public.multi_provider_records from public, anon, authenticated;

-- 보안-definer 실행 전용 스키마(없을 때만 생성). 별도 스키마에 두어 public
-- 함수 노출과 권한 누수 위험을 차단합니다.
create schema if not exists app_private;

-- PostgresDatabaseAdapter는 벤더 중립 SqlExecutor 계약을 주입받습니다. Supabase
-- service-role 클라이언트는 PostgREST를 통해 raw SQL을 실행할 수 없으므로, 서버 전용
-- 안전한 실행 경로로 이 보안-definer 함수를 사용합니다. params는 JSON 배열로 받아
-- format()으로 안전한 SQL 리터럴로 인라인합니다. SQL 인젝션은 format()의 %L 사양이
-- 자동으로 이스케이프하여 차단합니다.
create or replace function app_private.multi_provider_records_exec(
  query_text text,
  params jsonb default '[]'::jsonb
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inlined_query text := query_text;
  value_text text;
  value_index integer;
  total_params integer := jsonb_array_length(coalesce(params, '[]'::jsonb));
begin
  -- 각 $1, $2, ... 플레이스홀더를 안전한 리터럴로 치환합니다.
  for value_index in 1..total_params loop
    value_text := params ->> (value_index - 1);
    inlined_query := replace(inlined_query, '$' || value_index::text, quote_nullable(value_text));
  end loop;
  return query execute inlined_query;
end;
$$;

revoke all on function app_private.multi_provider_records_exec(text, jsonb) from public, anon, authenticated;

commit;
# 멀티 프로바이더 리소스 풀

`src/lib/multicloud`는 스토리지와 PostgreSQL 계열 DB를 벤더 중립 계약으로 묶습니다.

- Storage: AWS S3와 Cloudflare R2는 `S3CompatibleStorageAdapter`를 각각 등록하고, GCS는
  `GcsStorageAdapter`, Supabase는 `SupabaseStorageAdapter`를 사용합니다.
- Database: Supabase Postgres, Neon, CockroachDB, Cloud SQL의 각 SQL 실행기를
  `PostgresDatabaseAdapter`에 주입합니다.
- Router: 예상 사용량이 무료 용량의 90% 이상이면 다음 프로바이더로 넘기며, 오류가 누적된
  프로바이더의 회로를 30초간 열어 요청 지연을 막습니다.
- Read: 중앙 locator에 저장된 `storageProviderId`, `dbProviderId`, `storageKey`로 실제 위치를
  결정합니다. locator 자체는 단일 장애점이 되지 않도록 운영 DB에 복제하거나 강한 일관성을
  제공하는 작은 메타데이터 저장소를 사용해야 합니다.
- TTL: 외부 스케줄러가 매일 자정 `BatchCleanupScheduler.run()`을 호출합니다. 파일 삭제가
  성공한 경우에만 DB 레코드를 지우는 fail-closed 순서를 사용합니다.

각 서비스의 무료 용량은 변경될 수 있으므로 코드에 하드코딩하지 않습니다. 스토리지와 DB 모두
관리 API, 사용량 집계 테이블 또는 운영 설정에서 읽는 `usageProbe`를 주입하고 정기적으로
갱신해야 합니다. DB probe가 생략된 경우에는 연결 상태만으로 라우팅합니다.

SQL 프로바이더마다 다음 동일 테이블이 필요합니다.

```sql
create table multi_provider_records (
  id uuid primary key,
  storage_provider_id text not null,
  storage_key text not null,
  db_provider_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null
);
create index multi_provider_records_expiry_idx
  on multi_provider_records (expires_at);
```

이 테이블은 공개 Data API에 노출하지 않고 서버 전용 연결로만 접근하는 것을 기본으로 합니다.

# 다중 운영자 센터 배정 계획

## 확정 모델

- 센터 하나에는 여러 활성 운영자를 배정할 수 있다.
- 운영자 한 명은 활성 운영자 멤버십을 한 센터에만 가질 수 있다.
- 직원은 `membership_role = 'employee'`로 별도 배정한다.
- 직원의 `reports_to_operator_id`는 같은 센터에 활성 배정된 운영자 중 한 명이어야 한다.
- `stores.operator_id`는 대표 운영자 호환 컬럼으로 유지한다. 운영자 접근 권한의 기준은 `store_memberships`다.

## 0단계 영향 범위

`stores.operator_id` 참조는 전체 179개 `operator_id` 참조 중 52개다.

- DB 보안 경계: `validate_store_membership`, 자기 센터 입찰·구매 차단, 출고 그룹 처리, 지원 채팅 라우팅
- 관리 RPC: `get_owner_store_management`, `manage_owner_store`, `owner_store_snapshot`
- API/UI: Owner 센터 목록, Owner 대시보드, 운영자 상품 센터 범위
- 테스트: `store-membership-permissions`, `central-fulfillment-intake` 및 관련 계약 테스트
- 과거 마이그레이션: 이미 적용된 이력은 수정하지 않고 후속 `create or replace` 마이그레이션으로 현재 함수를 교체

0단계에서 확인한 현재 제약은 기존 `validate_store_membership`가 활성 운영자 멤버십을 `stores.operator_id`와 동일한 사용자로만 허용한다는 점이다.

## 1단계 완료 범위

`20260805020000_prepare_multi_operator_store_memberships.sql`에서 다음만 변경한다.

- 기존 대표 `stores.operator_id` 값에서 운영자 멤버십을 멱등적으로 보장한다.
- grade 0 Owner가 대표 운영자인 레거시 센터도 운영자 멤버십을 보장한다.
- 활성 운영자 사용자당 센터 하나만 허용하는 부분 유니크 인덱스를 추가한다.
- 센터별 운영자 수에는 제한을 두지 않는다.
- 운영자/grade 0 Owner 역할 검증을 추가한다.
- 직원은 같은 센터의 활성 운영자에게 보고해야 한다는 기존 규칙을 다중 운영자에 맞게 유지한다.
- 대표 운영자 멤버십은 대표 컬럼을 먼저 변경하기 전에는 비활성화할 수 없게 한다.

이번 단계에서는 Owner 관리 RPC, 다중 배정 UI, 운영자 센터 선택 저장, 기존 `operator_id` 기반 보안 함수의 전체 전환은 실행하지 않는다. 해당 작업은 2단계 이후 별도 검증과 함께 진행한다.

## 이후 단계

1. 보안 함수·RLS를 멤버십 기반으로 전환한다.
2. Owner 관리 RPC를 다중 운영자 추가·제거 계약으로 전환한다.
3. Owner 센터에서 내 계정을 센터 목록에 배정하는 UI를 추가한다.
4. 운영자 센터에 `전체 센터`와 저장된 개별 센터 선택을 추가하고, 선택 상태를 DB 기반 사용자 설정으로 저장한다.
5. 운영자·직원 범위와 테스트를 검증한다.

## 1·2단계 완료 범위

- `20260805020000_prepare_multi_operator_store_memberships.sql`: 대표 `stores.operator_id` 기준 멤버십 백필, grade-0 Owner 멤버십 보장, 활성 운영자 1센터 부분 유니크, `validate_store_membership` 교체.
- `20260805030000_use_store_membership_for_self_store_security.sql`: `can_purchase_product`, `reject_own_store_bid`, `reject_own_store_purchase`, `is_active_store_operator`를 멤버십 기준으로 전환.

## 3단계 완료 범위

- `20260805040000_owner_multi_operator_management.sql`: `operator_assign`/`operator_remove` 이벤트 액션, `owner_store_snapshot`의 `operators` 배열, `set_owner_store_operator` RPC, `manage_owner_store`에 grade-0 Owner 배정 허용, 대표 운영자 해제 가드.
- `src/app/api/admin/owner/stores/route.ts`: PATCH `operator_assign`/`operator_remove` 처리.
- `OwnerStoreManagementConsole.tsx`: 각 센터 카드에 `함께 운영하는 운영자` 목록(대표 표시, 대표 해제 비활성), 운영자 추가 선택·배정, 해제 버튼. Owner도 배정 대상에 표시(`(소유자)`).

## 4단계 완료 범위

- `20260805050000_operator_store_scope_preferences.sql`: `operator_store_scope_preferences` 테이블(RLS, 사용자 소유 정책), `get_operator_store_scope`, `set_operator_store_scope`(운영자/소유자 검증, 배정된 활성 센터만 선택).
- `src/app/api/admin/operator/store-scope/route.ts`: GET(범위 + 소속 센터 목록), POST(범위 저장).
- `useOperatorStoreScope` zustand 스토어 + `OperatorStoreScopeSelector`(운영자 레이아웃 상단, `전체 센터`/개별 센터 선택, 세션 초기화 후에도 DB에서 복원).
- `OperatorProductsConsole`: 선택한 센터로 상품 목록·등록 숍 드롭다운 범위 제한.

## 5단계 검증 범위

- `tests/core/operator-store-scope.test.mjs`, `tests/core/multi-operator-owner-management.test.mjs` 등 계약 테스트.
- `npm run test` 전체, `tsc --noEmit`, `eslint`, `git diff --check`.
- Supabase 마이그레이션 push 및 실제 도메인 배포 확인.

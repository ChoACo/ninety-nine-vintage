# 역할과 권한

## 역할

### 시스템 관리자 (`owner`)

초기 1명이다. 전체 매장, 운영자, 직원, 시스템 설정과 감사 기록에 접근한다. 공용 사업자 입금 계좌와 결제 방식 같은 전역 설정은 시스템 관리자만 변경한다.

### 매장 운영자 (`operator`)

초기 2명이며 각자 명시적 소속이 있는 담당 매장을 운영한다. 자기 매장의 상품과 준비 업무를 관리하고 공용 입금 목록을 조회·확인한다. 다른 매장의 상품 내용은 수정하지 않는다.

### 매장 직원 (`staff`, 현재 코드의 `employee`에 대응)

하나 이상의 명시적 매장 소속과 세부 권한을 가진다. 2026-07-22 이관 기본값은 자기 매장 상품 관리만 허용하며 준비, 입금 확인, 직원 관리, 보고서 열람, 상품 공개, 중앙 업무는 각각 별도 권한 플래그로 분리한다.

### 고객 (`member` 및 고객 등급)

상품 조회, 통합 장바구니, 주문, 입금 안내, 보관, 배송 요청과 자기 기록 조회만 수행한다.

## 2026-07-22 운영 적용 상태

- `20260722040000_add_store_memberships_permissions.sql`이 `store_memberships`와 `manage_products`, `publish_products`, `prepare_orders`, `confirm_payments`, `receive_at_center`, `create_shipments`, `manage_staff`, `view_reports`를 운영에 활성화했다.
- 이관된 실제 운영자는 상품 관리·공개, 준비, 입금 확인, 직원 관리, 보고서 권한을 받고 중앙 입고와 송장 생성 권한은 받지 않는다. 이관된 직원은 상품 관리만 받고 나머지는 기본 `false`다. 중앙 입고·송장 권한은 Owner만 부여할 수 있다.
- `stores.operator_id`가 Owner인 레거시 매장은 실제 운영자 소속을 임의 생성하지 않는다. 해당 매장은 Owner의 암시적 전역 권한으로 계속 관리하며, 직원 소속과 중앙 권한도 추론하지 않는다.
- `20260722050000_activate_central_fulfillment_intake.sql`과 운영 UI/API는 `prepare_orders`로 매장 준비·인계를 제한하고, 중앙 데이터 경계는 `receive_at_center`를 검사한다. 현재 중앙 입고 웹 화면은 Owner 전용이다.
- `create_shipments`는 권한 모델에 존재하지만 canonical Shipment, 합포장 선행 조건, 주문/배송 요청당 송장 1건 제약과 구 배송 우회 차단은 아직 구현되지 않았다.

## 목표 권한 행렬

| 작업 | 시스템 관리자 | 매장 운영자 | 권한 있는 직원 | 고객 |
|---|---:|---:|---:|---:|
| 전체 매장/권한 관리 | O | X | X | X |
| 자기 매장 직원 관리 | O | O | 별도 권한 | X |
| 자기 매장 상품 등록·수정 | O | O | 별도 권한 | X |
| 자기 매장 상품 즉시 공개 | O | O | 별도 권한 | X |
| 다른 매장 상품 수정 | O | X | X | X |
| 통합 입금 목록 조회 | O | O | 별도 권한 | X |
| 통합 입금 확인·정정 | O | O | 별도 권한 | X |
| 공용 사업자 입금 계좌 변경 | O | X | X | X |
| 자기 매장 상품 준비·인계 | O | O | 별도 권한 | X |
| 중앙 입고 확인·보관 | O | 지정 권한 | 지정 권한 | X |
| 합포장·송장 생성 | O | 지정 권한 | 지정 권한 | X |
| 자기 주문/보관/배송 조회 | 운영 지원 | 운영 지원 | 운영 지원 | O |
| PortOne 활성화 | O | X | X | X |

## 권한 모델 규칙

- 역할명만으로 매장 접근을 추론하지 않는다. 매장 소속 또는 명시적 권한을 서버와 RLS에서 확인한다.
- UI에서 버튼을 숨기는 것은 보안 경계가 아니다. API, RPC, RLS가 같은 범위를 강제한다.
- 운영 적용된 세부 권한 키: `manage_products`, `publish_products`, `prepare_orders`, `confirm_payments`, `receive_at_center`, `create_shipments`, `manage_staff`, `view_reports`.
- 고정가 통합 주문의 공용 입금 큐는 주문에 자기 매장 상품이 포함됐는지와 무관하게 시스템 관리자와 모든 활성 매장 운영자가 공동 조회·확인·정정한다.
- `confirm_payments` 권한 기반은 생겼지만 기존 공용 입금 API/RPC의 직원 허용 조건은 아직 이 플래그로 전환하지 않았다. 따라서 직원(`employee`)은 현재도 공용 입금 큐와 원장 mutation에서 제외되며, 후속 전환 시 API·RPC·RLS가 같은 조건을 강제해야 한다.
- 타 매장 상품의 전체 원문 행은 공유하지 않는다. 공용 큐에는 결제 대조에 필요한 주문 식별자·회원 식별자·상품명/이미지/금액 요약·예정액/누적액/잔액·결제 상태·계좌 스냅샷·원장 행위자와 시각만 투영한다.
- 숨은 Owner 테스트 회원은 실제 FK와 상태 전이를 검증하기 위한 Owner 전용 proxy 계정이다. 운영자는 UUID를 알고 있어도 대기 목록, 경매 잔액 조회, 입금 기록, 역분개 RPC로 접근할 수 없다.
- 입금 확인과 활성화된 중앙 준비·인계·입고·보관 처리는 행위자와 시각을 감사 로그에 남긴다. 송장 감사는 canonical Shipment 전환과 함께 완성한다.
- 시스템 관리자 계정은 일반 공개 UI에서 별도 등급으로 노출하지 않는다.

## 현재 모델과의 대응

현재 코드는 기존 `account_access_roles`의 `owner`, `operator`, `employee`, `band_member`, `member`와 직원의 `reports_to_operator_id`, 매장의 단일 `operator_id`를 신원·보고 관계로 유지하면서 `store_memberships`를 매장 범위와 세부 권한의 운영 기준으로 함께 사용한다. `has_store_permission`과 `has_business_permission`은 활성 사업체·매장·소속·권한을 검사하고 Owner에게만 암시적 전역 권한을 준다. 상품 등록·초안 수정·삭제·공개의 DB 경계는 기존 운영자 역할 추론 대신 각각 `manage_products`와 `publish_products`를 기준으로 사용한다. 근거와 차이는 [현행 감사](./current-state-audit.md)에 기록한다.

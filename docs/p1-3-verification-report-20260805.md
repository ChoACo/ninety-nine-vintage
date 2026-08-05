# P1-3 단계 6 검증 보고서

작성일: 2026-08-05
기준 작업: P1-3 단계 2·3 보강

## 검증 범위

- `inventory_shipments` 포장·발송·송장 변경 권한의 DB mutation gate
- 운영자 송장 정정 사유 입력 및 API 전달
- 단일 Shipment 송장 상태 표시
- 기존 배송·fulfillment·결제·권한 회귀

## 실행 결과

| 검증 | 결과 |
| --- | --- |
| `npm test` | 통과, 256/256 |
| `npm run lint` | 통과 |
| `npx tsc --noEmit` | 통과 |
| `npm run build` | 통과 |
| `git diff --check` | 통과 |
| migration parity | 보류, `20260805010000` 원격 미적용 |

## 확인된 계약

- 포장·발송·송장 변경은 Owner 또는 `create_shipments` 권한이 없으면 DB trigger에서 실패한다.
- 송장 수정·삭제는 정정 사유 없이는 API와 화면에서 진행되지 않는다.
- 송장 정정 사유는 actor-scoped 멱등 키 fingerprint에 포함된다.
- 기존 CAS, 멱등성, append-only 이벤트, 미출고 상품 gate는 유지된다.
- 고객 화면의 공개 배송 상태는 기존 `preparing`·`shipped` 계약을 유지한다.

## 남은 운영 반영

- 새 migration은 원격 DB에 아직 적용하지 않았다.
- 원격 migration 적용 후 `npm run verify:migrations`를 다시 실행해야 한다.
- 실제 운영 계정의 포장·발송·송장 정정 smoke 검증은 원격 migration 적용 후 별도로 수행해야 한다.
- P1-3 전체 완료를 위해서는 레거시 `shipping_requests`·canonical `commerce_shipments`와 v2 `inventory_shipments`의 상호 관계 및 기존 데이터 승격 정책을 후속 확정해야 한다.

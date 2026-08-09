# 06. AI 변경 승인 리뷰

작성일: 2026-08-08 (Asia/Seoul)
검토 기준: `docs/agent-handoff/05-ai-implementation.md` 및 AI 직접 관련 현재 diff

# FIX_REQUIRED

## 1. fallback usage log의 model metadata가 실제 호출과 일치하지 않음

- 파일 경로: `src/lib/ai/GeminiProductEnhancer.server.ts`
- 파일 경로: `src/lib/ai/tokenTracker.ts`
- 파일 경로: `supabase/migrations/20260804010000_create_ai_token_usage_logs.sql`
- 파일 경로: `supabase/migrations/20260808120000_add_ai_usage_status_column.sql`

### 수정 지시

모든 모델 실패 후 `usage`를 누적해 한 행으로 기록하면서 `lastModelAttempted`를 해당 누적 토큰의 모델처럼 저장하지 마라. 현재 fallback은 primary와 fallback 모델을 모두 시도할 수 있지만 DB에는 마지막 모델 하나만 기록된다. `AiEnhancementMeta.model = null`과 DB `model NOT NULL`의 의미도 서로 다르다.

다음 중 하나의 명시적 계약으로 수정하라.

- 모델별 실제 usage를 모델별 행으로 기록하고 최종 상태를 각 행에 포함한다.
- 또는 누적 요청 행의 `model`을 nullable로 바꾸고 `attempted_models`/모델별 usage 정보를 별도 JSON 또는 자식 행으로 보존한다.

### 완료 조건

- `success`: 실제 성공한 primary 모델이 DB와 응답 metadata에 동일하게 기록된다.
- `partial_fallback`: 실제 성공한 fallback 모델과 primary 실패 사유가 기록된다.
- `fallback`: 응답 `model`과 DB의 단일 모델 필드가 특정 모델의 성공처럼 보이지 않는다.
- 누적 토큰을 특정 `lastModelAttempted` 모델에 잘못 귀속하지 않는다.
- 실제 primary 실패 후 fallback 성공 및 모든 모델 실패 fixture에서 model/usage/status가 검증된다.

## 2. 응답에 status가 없을 때 success로 추정하는 경로 제거

- 파일 경로: `src/lib/ai/productEnhancement.ts`
- 관련 함수: `requestProductEnhancement`

### 수정 지시

현재 응답이 200이고 `enhancement`만 있으면 `payload.status`가 없어도 `success`로 처리한다. 이는 구버전 서버, 불완전한 envelope, 잘못된 fallback 응답을 정상 AI 성공으로 위장할 수 있다.

상태 계약을 엄격하게 적용하라. 현재 서버가 반환하는 네 가지 상태 중 하나가 없거나 `ai` metadata가 계약에 맞지 않으면 `failed` 또는 명시적인 compatibility 상태로 처리하고 `isAiEnhancementApplied`가 true가 되지 않게 하라.

### 완료 조건

- `success`, `partial_fallback`, `fallback`, `failed`만 유효한 상태로 인정한다.
- status 누락·알 수 없는 status·잘못된 metadata는 success로 승격되지 않는다.
- fallback 결과는 `isAiEnhancementApplied`가 false이고 원본값 유지가 보장된다.
- 기존 상품 등록은 AI 결과가 `failed` 또는 `fallback`이어도 계속 진행된다.
- 누락 status 응답에 대한 회귀 테스트가 추가된다.

## 3. 실제 서버 3회 실패 및 fallback 경로 테스트 부족

- 파일 경로: `tests/core/ai-enhancement-status-contract.test.mjs`
- 파일 경로: `tests/core/product-ai-and-multicloud.test.mjs`
- 관련 구현: `src/lib/ai/aiModelRouter.ts`, `src/lib/ai/GeminiProductEnhancer.server.ts`

### 수정 지시

현재 테스트는 synthetic HTTP response를 client mapper에 전달하고, `enhancer`/router는 정적 문자열만 검사한다. 따라서 실제 다음 실행 경로를 검증하지 않는다.

- 한 round에서 primary 실패 후 fallback 모델 성공
- 모든 모델 실패가 3 round 반복됨
- `modelsTried`/`attemptedModels`/`attempts` 누적
- 최종 fallback 원본값 반환
- fallback 상태 usage logging
- usage logging 실패 시 `usageLogged: false`

실제 `routeCompletion`과 `GeminiProductEnhancer`를 호출하는 테스트를 추가하라. 외부 OpenRouter에 연결하지 말고 `fetch`와 token log 경계를 주입하거나 mock하여 모델별 응답·실패를 재현해야 한다.

### 완료 조건

- primary 실패 → fallback 성공이 실제 실행되어 `partial_fallback`이 반환된다.
- 모든 모델 실패를 3회 반복하면 정확히 `fallback`이 반환된다.
- fallback의 `enhancement`는 원본 snapshot이고 AI 적용 플래그는 false다.
- 실제 모델 호출 횟수와 `attempts`가 일치한다.
- logging 성공·실패 양쪽에서 결과 상태가 변하지 않고 metadata가 정확하다.
- 단순 `assert.match`만으로 위 실행 결과를 통과시키는 테스트가 아니다.

## 4. failed 요청의 usage/status 기록 계약이 실제 route와 불일치함

- 파일 경로: `src/app/api/admin/operator/products/enhance/route.ts`
- 파일 경로: `src/lib/ai/tokenTracker.ts`
- 파일 경로: `supabase/migrations/20260808120000_add_ai_usage_status_column.sql`

### 수정 지시

문서는 요청당 최종 상태를 `ai_token_usage_logs`에 기록한다고 정의하지만, 현재 input validation 실패·quota reservation 실패·daily quota 거절은 `logTokenUsage`를 호출하지 않는다. provider 전체 실패는 enhancer가 `fallback`으로 반환하므로 `failed` 경로와 실제 서버 실행 의미도 분리되어 있다.

다음 중 하나를 명시하고 구현하라.

- AI 요청이 시작된 모든 경우 `failed` 또는 `fallback`을 usage log에 남긴다.
- provider 호출이 시작되지 않은 validation/quota 거절은 usage log 대상이 아님을 계약과 owner 집계에서 명시하고, provider 호출 실패만 `fallback`으로 기록한다.

### 완료 조건

- `failed`와 `fallback`의 서버 발생 조건이 문서·route·enhancer·DB status CHECK에서 동일하다.
- quota/input 거절과 provider 3회 실패가 owner usage 집계에서 서로 혼동되지 않는다.
- logging 실패는 `usageLogged: false`와 서버 error log로 확인 가능하다.
- failed/fallback/partial_fallback의 월간 호출 수 집계가 실제 status를 기준으로 검증된다.

## 5. 기존 호출자와 반환형 호환성 검증 보강

- 파일 경로: `src/lib/ai/productEnhancement.ts`
- 파일 경로: `src/components/admin/operator/OperatorProductsConsole.tsx`
- 파일 경로: `src/components/admin/operator/OperatorXlsxImportModal.tsx`
- 파일 경로: `tests/core/ai-enhancement-status-contract.test.mjs`

### 수정 지시

`requestProductEnhancement`와 `processQuickRegistrationAI`의 반환형이 `ProductEnhancement | null`에서 envelope로 바뀌었다. 현재 저장소의 직접 호출자는 갱신됐지만, 반환 envelope가 실제 호출자에서 항상 `isAiEnhancementApplied`를 거쳐 적용되는지와 Excel 행별 failed/fallback 격리가 실행 테스트로 보장되어야 한다.

### 완료 조건

- 저장소 전체 직접 호출자가 새 반환형을 사용하고 TypeScript 검사를 통과한다.
- quick registration과 XLSX import 모두 `success`/`partial_fallback`만 AI 값을 적용한다.
- `fallback`/`failed` 행은 원본 입력을 유지하고 다른 행의 결과를 손상하지 않는다.
- 등록 POST는 어떤 AI 상태에서도 non-blocking으로 유지된다.

이번 리뷰에서는 코드를 수정하지 않았다.

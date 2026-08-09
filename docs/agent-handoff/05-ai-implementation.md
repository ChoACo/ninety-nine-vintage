# 05. AI 보정 상태 계약 (Step 5)

작성일: 2026-08-08 (Asia/Seoul)

# BASE COMMIT

`c36a2db feat: cap cart holds at three, add rate limiting, and surface friendly UX errors`

> 본 Step 5 변경은 별도 커밋 없이 이 문서 기준으로 워킹 트리에만 존재한다.
> Step 5가 수정한 파일은 shipping diff(04)와 겹치지 않는다.

# FINAL HEAD

`c36a2db` (변경 미커밋). 실패한 경우 커밋이 필요하면 별도 지시 후 커밋한다.

# STATUS CONTRACT

AI 보정 요청의 최종 결과는 네 가지 상태로 통일한다. 단일 정의는 `src/lib/ai/productEnhancement.ts`의 `ProductEnhancementStatus`다.

| 상태 | HTTP | enhancement | 의미 | 사용 모델 |
|---|---|---|---|---|
| `success` | 200 | AI 결과 | 1차 모델(`PRIMARY_MODEL`)이 유효한 JSON을 반환 | `PRIMARY_MODEL` |
| `partial_fallback` | 200 | AI 결과 | 1차 모델 실패 후 fallback 모델이 유효한 결과 반환 | fallback 모델 |
| `fallback` | 200 | 원본값 스냅샷 | 모든 모델 시도 실패 → 원본 입력값으로 진행. **정상 AI 성공으로 기록하지 않음** | null |
| `failed` | 400/429/503 | null | 파이프라인이 결과를 만들지 못함 (입력 검증·쿼타·네트워크) | null |

- `success`의 판정 기준은 `result.usedModel === PRIMARY_MODEL`이며, 같은 모델의 재시도 성공(round > 0)도 `success`로 유지한다(재시도 횟수는 `ai.attempts`에 반영).
- `partial_fallback`은 fallback 모델이 사용된 경우이며 `ai.fallbackReason`에 1차 시도 실패 사유를 남긴다.
- `fallback`도 200으로 반환하지만 클라이언트는 `isAiEnhancementApplied(status)`가 false이므로 "AI 보정 적용"으로 표시하지 않고 원본값을 유지한다. 이로써 "AI 전체 실패 후 원본 반환"을 정상 AI 성공으로 오인/기록하는 문제를 제거한다.
- `failed`는 route 레벨 400/429/503 오류 본문에 `status: "failed"`를 포함해 클라이언트가 상태를 구분할 수 있게 한다.

## AI 메타데이터 (`AiEnhancementMeta`)

모든 결과에 다음을 일관되게 포함한다.

```
{
  provider: "openrouter",
  model: string | null,          // 결과를 만든 모델(success/partial_fallback), 그 외 null
  attempts: number,              // 이 요청에서 실제 호출한 모델 수 (round×모델 누적)
  fallbackReason: string | null, // partial_fallback/fallback 사유
  usageLogged: boolean,          // 토큰 사용량 로그 기록 성공 여부
}
```

- `attempts`는 `routeCompletion`이 반환하는 `attemptedModels`와 실패 round의 `modelsTried`를 누적한 실제 모델 호출 수다.
- 사용량 로그(`ai_token_usage_logs`) 기록 자체가 실패한 경우 결과 상태는 유지하되 `usageLogged: false`로 운영자가 구분한다.

## 사용량 로그 상태 분리

- `ai_token_usage_logs`에 `status TEXT NOT NULL DEFAULT 'success' CHECK (status IN (...))` 컬럼 추가 (migration `20260808120000_add_ai_usage_status_column.sql`).
- 요청당 1행으로 최종 상태와 누적 토큰을 기록한다. `fallback` 요청은 `fallback` 상태로 기록되어 정상 `success` 호출 수 집계에 포함되지 않는다.
- `getMonthlyTokenUsage`는 `success`/`partial_fallback` 상태만 primary/fallback 호출 수로 집계하고, `fallback`/`failed` 행은 토큰 합계에만 반영한다. 이로써 AI 전체 실패가 "정상 AI 성공 호출 수"를 부풀리지 않는다.

## 등록 미차단 보장

AI 보정은 클라이언트가 `/enhance`를 별도 호출해 미리보기로만 사용하고, 상품 등록 POST(`products/route.ts`)는 AI 필드를 선택 입력으로 받는다. 따라서 어떤 AI 상태여도 상품 등록은 차단되지 않는다.

# FILES CHANGED

Step 5 변경 (shipping diff 04와 분리):

- `src/lib/ai/productEnhancement.ts` — `ProductEnhancementStatus`, `AiEnhancementMeta`, `ProductEnhancementResult`, `isAiEnhancementApplied`, 클라이언트 상태 매핑, `ExcelEnhancementResult`에 상태 추가
- `src/lib/ai/aiModelRouter.ts` — `PRIMARY_MODEL` export, `RouteCompletionResult`에 `attemptedModels`/`fallbackReason`, 실패 시 `modelsTried` 부착
- `src/lib/ai/GeminiProductEnhancer.server.ts` — `enhance`가 `ProductEnhancementResult` 반환, success/partial_fallback/fallback 매핑, 요청당 상태 사용량 로그
- `src/lib/ai/tokenTracker.ts` — `logTokenUsage` `Promise<boolean>` + `status` 기록, `getMonthlyTokenUsage` 상태 인지 집계, 하드코딩 모델명을 `PRIMARY_MODEL`로 대체
- `src/app/api/admin/operator/products/enhance/route.ts` — 200 응답에 결과 envelope 전달, 400/503/429 오류에 `status: "failed"` 추가
- `src/components/admin/operator/OperatorXlsxImportModal.tsx` — `isAiEnhancementApplied`로만 보정 적용, 미적용 행 안내
- `src/components/admin/operator/OperatorProductsConsole.tsx` — 결과 envelope에서 applied 상태일 때만 미리보기 적용
- `supabase/migrations/20260808120000_add_ai_usage_status_column.sql` — `ai_token_usage_logs.status` 컬럼 추가
- `tests/core/product-ai-and-multicloud.test.mjs` — 기존 테스트를 새 envelope/상태 계약으로 갱신
- `tests/core/ai-enhancement-status-contract.test.mjs` — 신규: 클라이언트 4상태 매핑 + 정적 계약

# TESTS

- `tests/core/product-ai-and-multicloud.test.mjs` — Excel 동시성 격리(failed 행 포함), Gemini route 정적 계약, 상태 계약 정적 검증
- `tests/core/ai-enhancement-status-contract.test.mjs` — success / partial_fallback / fallback / failed(429·네트워크) 클라이언트 매핑, `processQuickRegistrationAI` envelope 전달, router·enhancer·tracker·migration 일관성 정적 검증
- 기존 suite 회귀: shipping(04), P1-3, unified fulfillment, operator XLSX, storage gauge 등 전체 통과

# TEST RESULTS

| 명령 | 결과 |
|---|---|
| `npm test` | 292/292 pass |
| `npm run lint` | pass |
| `npx tsc --noEmit` | pass |
| `npm run build` | Compiled successfully (10.6s) |

# BACKWARD COMPATIBILITY

- `requestProductEnhancement`/`processExcelWithAI`의 반환형이 `ProductEnhancement | null` → `ProductEnhancementResult`로 바뀌었으며, 호출부(콘솔·XLSX 모달)를 함께 갱신했다. `ExcelEnhancementResult.enhancement` 필드는 유지해 하위 호환을 남겼다.
- 기존 `ai_token_usage_logs` 행은 `status` 기본값 `'success'`로 채워져 이전 동작(성공 round 기록)과 모순되지 않는다.
- `/enhance` 200 응답 본문이 `{ enhancement }` → 결과 envelope(`{ status, enhancement, ai }`)로 바뀌었다. 구버전 클라이언트가 `enhancement` 필드를 직접 읽는 구조는 아니며, 신버전 클라이언트만 배포하므로 안전하다. 서버가 `status`를 주지 않는 경우 클라이언트는 `success`로 기본 처리한다.
- `productEnhancement.ts`는 `server-only`를 쓰지 않으므로 클라이언트·테스트 양쪽에서 그대로 import된다.
- rename/리팩터 범위: `GeminiProductEnhancer` 클래스·파일명과 "Gemini AI 자동 보정" UI 라벨은 1차 모델명을 그대로 가리키므로 유지했다(대규모 rename 회피). 코드상 Gemini가 아니라 OpenRouter를 의미하는 곳(모델 라우터 `OR_API`, `OPENROUTER_API_KEY`)은 그대로 정확한 이름을 쓴다.

# KNOWN LIMITATIONS

- `attempts`는 라우터가 실패 round에서 버린 `modelsTried`를 더하지만, 네트워크 레벨 오류로 모델 응답 자체가 없는 경우에도 라우터 재시도 수를 기반으로 집계한다. 실제 provider 접근 횟수와는 최대 MODELS 길이만큼 차이가 날 수 있다.
- `logTokenUsage`는 요청당 1행으로 누적 토큰을 기록하므로 round별 모델 단위 토큰 세분화는 사라진다. 운영자가 모델별 정확한 소모를 원하면 로그를 round 단위로 쪼개야 한다.
- migration `20260808120000_add_ai_usage_status_column.sql`은 Docker canonical shipping suite의 명시적 파일 목록에 포함되지 않아 그 suite에서는 실행되지 않는다. production 적용 전 migration parity에서 함께 확인해야 한다.
- `failed` 상태(쿼타·한도)는 `app_private.gemini_product_enhancement_daily_usage`에 별도로 기록되며 `ai_token_usage_logs`에는 남지 않는다. 두 소스의 교차 집계는 운영 대시보드에서 별도 구현이 필요하다.
- 상품 등록 POST는 AI 필드를 선택 입력으로 받으므로 미차단 계약은 유지되지만, 클라이언트가 실수로 AI 적용 행을 그대로 제출하면 enhanced_title이 함께 저장될 수 있다(오프라인 UX 확인 수준). 이는 기존 동작과 동일하다.

-- migration: add outcome status to ai_token_usage_logs
-- fallback/failed 요청이 정상 AI 성공으로 집계되지 않도록 요청별 결과 상태를 기록합니다.
ALTER TABLE public.ai_token_usage_logs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success'
  CHECK (status IN ('success', 'partial_fallback', 'fallback', 'failed'));

COMMENT ON COLUMN public.ai_token_usage_logs.status IS
  'AI enhancement request outcome: success, partial_fallback, fallback, failed';

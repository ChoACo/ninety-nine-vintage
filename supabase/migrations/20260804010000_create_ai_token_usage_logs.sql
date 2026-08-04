-- migration: create ai_token_usage_logs
CREATE TABLE IF NOT EXISTS public.ai_token_usage_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openrouter',
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT 'chat/completions',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_token_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_logs_created_at
  ON public.ai_token_usage_logs (created_at DESC);

-- 서버(service role)만 쓰고, 오너만 읽습니다.
-- 오너 식별은 account_access_roles.role_code='owner' 컬럼을 사용합니다.
DROP POLICY IF EXISTS "owners_can_read_usage_logs" ON public.ai_token_usage_logs;
CREATE POLICY "owners_can_read_usage_logs"
  ON public.ai_token_usage_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.account_access_roles roles
      WHERE roles.user_id = auth.uid()
        AND roles.role_code = 'owner'
    )
  );
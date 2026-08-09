begin;

alter table public.ai_token_usage_logs
  alter column model drop not null,
  add column if not exists attempted_models text[] not null default '{}'::text[];

comment on column public.ai_token_usage_logs.model is
  'The model that produced a valid enhancement; null when no model succeeded.';
comment on column public.ai_token_usage_logs.attempted_models is
  'Ordered model attempt history for the request, including repeated retry rounds.';

commit;

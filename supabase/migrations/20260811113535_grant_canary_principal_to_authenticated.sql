-- RLS policies evaluate this zero-argument helper as the current session.
-- It returns only auth.uid() unless the fixed Owner has an active, bounded
-- role canary, in which case it returns that already-authorized target.

grant execute on function public.current_authorization_principal()
to authenticated;

comment on function public.current_authorization_principal() is
  'Returns the caller authorization principal; authenticated execution is required by membership RLS and exposes no arbitrary-user lookup.';

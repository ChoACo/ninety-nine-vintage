begin;

-- Historical grants left these policy helpers directly callable by anon and
-- service_role. They evaluate the current authenticated identity and only need
-- EXECUTE for authenticated RLS checks.
revoke all on function public.can_access_support_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_access_support_conversation(uuid)
  to authenticated;

revoke all on function public.can_send_support_message(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_send_support_message(uuid)
  to authenticated;

commit;

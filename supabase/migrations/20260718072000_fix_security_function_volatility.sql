-- These routines derive results from the current wall-clock time. Mark them
-- VOLATILE so PostgreSQL never treats a changing block expiry or request status
-- as stable across a wider query execution plan.

alter function public.is_security_ip_blocked(text) volatile;
alter function public.list_my_security_log_access_requests() volatile;

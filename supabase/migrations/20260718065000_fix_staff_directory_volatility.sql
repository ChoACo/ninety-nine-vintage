-- The staff directory compares sanction expiry against clock_timestamp().
-- Mark the function VOLATILE so PostgreSQL does not cache a time-sensitive
-- result under a STABLE contract.
alter function public.get_staff_member_directory(integer, integer) volatile;

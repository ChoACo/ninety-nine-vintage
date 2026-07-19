-- Keep the provider subject out of direct staff queries. Members can read only
-- their own row; staff receive the operational subset through the directory RPC.
drop policy if exists "Staff read verified Kakao profiles"
on public.kakao_member_profiles;

begin;

-- Trigger functions run through their owning triggers. Supabase's default
-- function ACL left them directly executable even though no client RPC needs
-- that privilege.
revoke all on function public.anonymize_member_payment_history()
  from public, anon, authenticated, service_role;
revoke all on function public.anonymize_member_shipping_history()
  from public, anon, authenticated, service_role;
revoke all on function public.assign_kakao_identity_access_role()
  from public, anon, authenticated, service_role;
revoke all on function public.assign_kakao_member_access_role()
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_member_account()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_owner_auth_update()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_owner_kakao_identity_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_owner_kakao_identity_update()
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_support_conversation_summary()
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_product_inquiry_operator()
  from public, anon, authenticated, service_role;
revoke all on function public.route_backlog_after_operator_promotion()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_access_role_to_auth_metadata()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_auth_user_profile()
  from public, anon, authenticated, service_role;
revoke all on function public.validate_operator_account_user()
  from public, anon, authenticated, service_role;
revoke all on function public.validate_support_assignment()
  from public, anon, authenticated, service_role;
revoke all on function app_private.mark_product_sale_completed_from_inventory()
  from public, anon, authenticated, service_role;

-- This routine is an internal implementation detail of guarded owner/member
-- enforcement RPCs. It accepts an arbitrary member id and intentionally has no
-- independent caller check, so clients must never execute it directly.
revoke all on function public.cancel_member_active_bids(
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

commit;

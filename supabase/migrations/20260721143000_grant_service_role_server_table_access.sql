begin;

-- New Supabase projects no longer auto-expose newly created public tables to
-- Data API roles. Pin the direct-table contract used by the repository's
-- service-key server client so clean and legacy projects behave the same.
-- Hidden service-key writers must be inventoried before this migration runs.

grant usage on schema public to service_role;

revoke all privileges on table
  public.account_access_roles,
  public.commerce_order_items,
  public.commerce_order_transfers,
  public.commerce_orders,
  public.kakao_member_profiles,
  public.kakao_profile_requirements,
  public.manual_transfer_orders,
  public.manual_transfer_payment_ledger,
  public.member_accounts,
  public.payment_attempts,
  public.payment_orders,
  public.products,
  public.profiles,
  public.security_activity_logs,
  public.shipping_credit_ledger,
  public.shipping_fee_payments,
  public.shipping_requests,
  public.site_status,
  public.stores,
  public.support_conversations,
  public.support_messages
from service_role;

grant select on table
  public.account_access_roles,
  public.commerce_order_items,
  public.commerce_order_transfers,
  public.commerce_orders,
  public.kakao_member_profiles,
  public.kakao_profile_requirements,
  public.manual_transfer_orders,
  public.manual_transfer_payment_ledger,
  public.member_accounts,
  public.payment_attempts,
  public.payment_orders,
  public.products,
  public.profiles,
  public.security_activity_logs,
  public.shipping_credit_ledger,
  public.shipping_fee_payments,
  public.shipping_requests,
  public.site_status,
  public.stores,
  public.support_conversations,
  public.support_messages
to service_role;

-- These are the only direct table mutations made by the service-key server
-- client. Kakao profile upsert also needs SELECT above for ON CONFLICT UPDATE.
grant insert on table public.account_access_roles to service_role;
grant insert, update on table public.kakao_member_profiles to service_role;
grant insert on table public.shipping_fee_payments to service_role;
grant update on table public.shipping_requests to service_role;
grant insert, update on table public.site_status to service_role;
grant insert on table public.support_messages to service_role;

commit;

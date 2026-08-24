begin;

-- Browser roles remain unable to read these operational tables directly.
-- The operator platform API already authenticates and scopes stores before
-- selecting only the fields needed to render its settings summary.
grant select (
  store_id,
  unpaid_fee_balance,
  fee_rollover_count,
  overdue_notice_sent_at
) on table public.store_service_subscriptions to service_role;

grant select (
  store_id,
  representative_name,
  business_registration_number,
  mail_order_registration_number,
  business_postal_code,
  business_address,
  business_address_detail
) on table public.store_enterprise_profiles to service_role;

commit;

-- Operator login IDs are deployment configuration, not schema constants.
-- The trusted provisioning script reconciles this table to exactly two rows.
-- is_staff() still requires a matching linked Auth user and operator_id claim.

alter table public.operator_accounts
  drop constraint if exists operator_accounts_reserved_username_check;

-- Fail closed while the two configured accounts are provisioned. This removes
-- only authorization slots; it does not delete Supabase Auth users and cannot
-- affect the administrator, who is not stored in operator_accounts.
delete from public.operator_accounts;

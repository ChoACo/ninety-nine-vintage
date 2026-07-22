-- This row exists before the migration: the replacement constraint must preserve it.
insert into public.commerce_orders (id, member_id, status) values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000003', 'awaiting_payment');
insert into public.commerce_order_transfers (id, order_id, expected_amount, status) values
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000901', 10, 'awaiting_transfer');
insert into public.manual_transfer_payment_ledger (id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo, recorded_by, idempotency_key) values
  ('00000000-0000-4000-8000-000000000903', 'commerce', '00000000-0000-4000-8000-000000000902', 'receipt', 10, '', '00000000-0000-4000-8000-000000000002', 'legacy:00000000-0000-4000-8000-000000000903');
insert into public.manual_transfer_payment_ledger (id, transfer_kind, commerce_order_transfer_id, entry_type, amount, memo, reversal_of, recorded_by, idempotency_key) values
  ('00000000-0000-4000-8000-000000000904', 'commerce', '00000000-0000-4000-8000-000000000902', 'reversal', 10, 'legacy reversal', '00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000002', null);

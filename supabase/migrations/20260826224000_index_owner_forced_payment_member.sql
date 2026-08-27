-- Cover the member foreign key used by owner payment-recovery audits.
-- The table remains intentionally inaccessible to client roles; owner-facing
-- reads and writes go through the audited SECURITY DEFINER RPC.
create index if not exists owner_forced_payment_confirmations_member_idx
on public.owner_forced_payment_confirmations(member_id, created_at desc);

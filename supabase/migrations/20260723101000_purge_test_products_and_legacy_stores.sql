-- Production cutover cleanup: every product currently in this project is test
-- data. Remove the dependent test payment/bid/audit rows first, then remove the
-- products and the two inactive legacy stores left by the role/store rebuild.

alter table public.payment_orders
  drop constraint if exists payment_orders_current_attempt_fkey;

delete from public.payment_attempts as attempts
using public.payment_orders as orders
where attempts.order_id = orders.id
  and orders.product_id in (select id from public.products);

delete from public.payment_orders
where product_id in (select id from public.products);

alter table public.payment_orders
  add constraint payment_orders_current_attempt_fkey
  foreign key (payment_id, id)
  references public.payment_attempts(payment_id, order_id)
  on delete restrict
  deferrable initially deferred;

-- Auction action audit is append-only during normal application traffic. The
-- immutable trigger is restored immediately after this one-off catalog purge.
drop trigger if exists owner_auction_action_audit_immutable
on public.owner_auction_action_audit;

delete from public.owner_auction_action_audit
where product_id in (select id from public.products);

create trigger owner_auction_action_audit_immutable
before update or delete or truncate on public.owner_auction_action_audit
for each statement execute function public.prevent_owner_auction_audit_mutation();

update public.products
set bid_locked_at = null,
    final_bid_id = null,
    final_bid_amount = null
where final_bid_id is not null;

delete from public.auction_bids
where product_id in (select id from public.products);

delete from public.products;

drop trigger if exists store_membership_permission_audits_append_only
on public.store_membership_permission_audits;

delete from public.store_membership_permission_audits
where membership_id in (
  select memberships.id
  from public.store_memberships as memberships
  join public.stores as stores on stores.id = memberships.store_id
  where not stores.is_active
);

create trigger store_membership_permission_audits_append_only
before update or delete or truncate on public.store_membership_permission_audits
for each statement execute function app_private.reject_store_membership_audit_mutation();

delete from public.store_memberships
where store_id in (
  select id
  from public.stores
  where not is_active
);

delete from public.stores
where not is_active;

do $$
begin
  if exists(select 1 from public.products) then
    raise exception 'test product purge must leave the product catalog empty';
  end if;

  if exists(select 1 from public.stores where not is_active) then
    raise exception 'legacy store purge must remove every inactive store';
  end if;

  if (select count(*) from public.stores where is_active) <> 2 then
    raise exception 'legacy store purge must retain both canonical stores';
  end if;
end;
$$;

notify pgrst, 'reload schema';

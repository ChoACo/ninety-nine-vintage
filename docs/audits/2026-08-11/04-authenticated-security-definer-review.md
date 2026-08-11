# authenticated SECURITY DEFINER 개별 권한 검토

검토 시각은 2026-08-11 KST이며 운영 PostgreSQL catalog와 함수 본문을 기준으로 한다. Supabase advisor의 `authenticated_security_definer_function_executable` 246건을 서명별로 모두 판정했다. 이 경고는 SECURITY DEFINER 사용 자체를 알리므로, 의도된 RPC는 caller/role/store guard와 최소 EXECUTE를 확인한 뒤 유지한다.

## 결론

- 246개 모두 `search_path=''` 고정과 명시 ACL을 확인했다.
- 내부 trigger 15개와 독립 caller guard가 없는 입찰 취소 helper 1개의 authenticated EXECUTE를 migration `20260811131000_harden_internal_security_definer_execute`로 회수했다.
- 공개 sold/premium 읽기 2개는 anon/auth 공개 계약으로 유지했다.
- 나머지 228개는 actor/role/store guard, guard된 delegate, RLS policy helper 또는 제한된 authenticated read 계약으로 유지했다.
- 별도 `app_private.mark_product_sale_completed_from_inventory()` trigger의 기본 PUBLIC EXECUTE도 함께 회수했다.

판정 코드: `KEEP_GUARDED_MUTATION/READ`는 본문에서 actor·role·scope guard를 확인한 함수, `KEEP_GUARDED_DELEGATE`는 guard된 하위 RPC에만 위임하는 wrapper, `KEEP_POLICY_HELPER`는 RLS/권한 판정 helper, `REVOKE_*`는 직접 실행 권한을 제거한 내부 함수다.

## 246개 개별 판정

| # | 함수 서명 | anon | 경로 고정 | 변경 토큰 | guard 토큰 | 판정 |
|---:|---|:---:|:---:|:---:|:---:|---|
| 1 | `access_role_for_user(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 2 | `add_member_warning(uuid,text,text)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 3 | `adjust_auction_cancellation_penalty(uuid,integer,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 4 | `adjust_member_shipping_credits(uuid,integer)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 5 | `advance_store_fulfillment_work(uuid,bigint,text,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 6 | `anonymize_member_payment_history()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 7 | `anonymize_member_shipping_history()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 8 | `append_inventory_exception_evidence(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 9 | `approve_owner_store_payout_account(uuid,boolean,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 10 | `approve_owner_store_service_plan(uuid,text,timestamp with time zone,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 11 | `assign_kakao_identity_access_role()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 12 | `assign_kakao_member_access_role()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 13 | `assign_unrouted_products_to_operator()` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 14 | `assign_unrouted_support_conversations()` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 15 | `auth_user_has_kakao_identity(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 16 | `begin_manual_transfer(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 17 | `begin_my_combined_auction_payment(text,boolean)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 18 | `begin_owner_operator_delegation(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 19 | `can_access_support_conversation(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 20 | `can_manage_member_enforcement()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 21 | `can_manage_members()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 22 | `can_manage_product_store(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 23 | `can_manage_products()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 24 | `can_manage_support_conversation(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 25 | `can_purchase_product(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 26 | `can_send_support_message(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 27 | `can_view_shared_fulfillment()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 28 | `can_view_shipping_queue()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 29 | `cancel_member_active_bids(uuid,uuid,timestamp with time zone)` | N | Y | Y | N | `REVOKE_INTERNAL_MUTATOR` |
| 30 | `cancel_my_shipping_credit_payment(uuid,bigint,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 31 | `cancel_owner_pending_manual_payment(text,uuid,bigint,bigint,integer,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 32 | `choose_support_operator(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 33 | `claim_my_second_chance_offer(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 34 | `clear_member_enforcement_history(uuid,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 35 | `complete_owner_settlement_batch(uuid,text,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 36 | `configure_inventory_fulfillment_rollout(uuid,boolean,boolean,boolean,bigint,bigint,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 37 | `configure_owner_store_automation(uuid,boolean,text,text,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 38 | `confirm_combined_auction_payment(uuid,bigint,text,bigint,integer,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 39 | `confirm_prepaid_shipping_credit_payment(uuid,bigint,text,bigint,integer,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 40 | `confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 41 | `confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)` | N | Y | N | N | `KEEP_GUARDED_DELEGATE` |
| 42 | `count_inventory_shipment_queue(boolean)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 43 | `create_commerce_manual_transfer_checkout(uuid[],text,boolean)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 44 | `create_commerce_manual_transfer_checkout(uuid[],text,boolean,boolean)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 45 | `create_commerce_order(uuid[],text,boolean)` | N | Y | N | N | `KEEP_GUARDED_DELEGATE` |
| 46 | `create_commerce_order_transfer(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 47 | `create_owner_settlement_batches(date)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 48 | `current_access_role()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 49 | `current_authorization_principal()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 50 | `current_owner_delegated_operator()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 51 | `decline_my_second_chance_offer(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 52 | `delete_managed_member(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 53 | `delete_managed_product(uuid,timestamp with time zone)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 54 | `delete_my_shipping_address(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 55 | `effective_member_account_status(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 56 | `end_owner_operator_delegation(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 57 | `ensure_member_account()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 58 | `get_approved_masked_security_logs(uuid,integer,integer)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 59 | `get_center_fulfillment_queue(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 60 | `get_central_fulfillment_buyer_groups(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 61 | `get_commerce_payment_status()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 62 | `get_commerce_shipment_queue(boolean,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 63 | `get_current_owner_operator_delegation()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 64 | `get_daily_revenue(date,date)` | N | Y | N | N | `KEEP_ROLE_GUARDED_READ` |
| 65 | `get_direct_store_fulfillment_groups(date,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 66 | `get_inventory_center_queue(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 67 | `get_inventory_exception_candidates(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 68 | `get_inventory_exception_queue(boolean,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 69 | `get_inventory_operational_health()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 70 | `get_inventory_shipment_queue(boolean,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 71 | `get_inventory_store_work_queue(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 72 | `get_manager_member_directory(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 73 | `get_manual_refund_queue(boolean,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 74 | `get_manual_transfer_ledger_balances(text,uuid[])` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 75 | `get_manual_transfer_settings()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 76 | `get_monthly_revenue(date,date)` | N | Y | N | N | `KEEP_ROLE_GUARDED_READ` |
| 77 | `get_my_cart_reservations()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 78 | `get_my_commerce_shipment_compat(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 79 | `get_my_enforcement_status()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 80 | `get_my_inventory_overview()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 81 | `get_my_inventory_shipments()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 82 | `get_my_legacy_eligible_orders()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 83 | `get_my_manual_refunds()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 84 | `get_my_nickname_state()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 85 | `get_my_second_chance_offers()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 86 | `get_my_won_products()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 87 | `get_online_member_directory(integer)` | N | Y | N | N | `KEEP_BOUNDED_AUTH_READ` |
| 88 | `get_operator_member_directory(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 89 | `get_operator_member_storage(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 90 | `get_operator_store_platform_management()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 91 | `get_operator_store_scope()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 92 | `get_operator_winning_members(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 93 | `get_or_create_employee_support_conversation()` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 94 | `get_or_create_operator_store_conversation(uuid,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 95 | `get_or_create_support_conversation(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 96 | `get_owner_fulfillment_staff_directory()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 97 | `get_owner_hidden_test_member()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 98 | `get_owner_hidden_test_member_audit(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 99 | `get_owner_hidden_test_shipping_requests()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 100 | `get_owner_hidden_test_won_products()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 101 | `get_owner_inventory_reconciliation_queue(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 102 | `get_owner_operator_delegation_audit(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 103 | `get_owner_operator_directory()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 104 | `get_owner_payment_confirmation_queue()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 105 | `get_owner_store_management()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 106 | `get_owner_store_platform_management()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 107 | `get_owner_withdrawn_member_retention(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 108 | `get_paid_inventory_store_queue(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 109 | `get_pending_manual_transfers(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 110 | `get_pending_nickname_change_requests()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 111 | `get_public_premium_store_ids()` | Y | Y | N | N | `KEEP_PUBLIC_READ` |
| 112 | `get_public_store_sold_feed_products(uuid,text,integer)` | Y | Y | N | N | `KEEP_PUBLIC_READ` |
| 113 | `get_shared_commerce_payment_order_summaries(uuid[])` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 114 | `get_shared_commerce_payment_queue_page(integer,timestamp with time zone,uuid,boolean)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 115 | `get_shipping_fee_refund_queue(boolean,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 116 | `get_staff_member_directory(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 117 | `get_store_daily_entitlements(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 118 | `get_store_financial_report(date,date)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 119 | `get_store_fulfillment_queue(integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 120 | `get_unified_manual_payment_queue(boolean,integer,integer)` | N | Y | N | N | `KEEP_GUARDED_DELEGATE` |
| 121 | `get_weekly_revenue(date,date)` | N | Y | N | N | `KEEP_ROLE_GUARDED_READ` |
| 122 | `get_yearly_revenue(date,date)` | N | Y | N | N | `KEEP_ROLE_GUARDED_READ` |
| 123 | `has_business_permission(uuid,text)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 124 | `has_kakao_identity(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 125 | `has_required_kakao_profile()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 126 | `has_store_permission(uuid,text)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 127 | `is_admin()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 128 | `is_employee()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 129 | `is_member()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 130 | `is_operator()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 131 | `is_owner()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 132 | `is_payment_deadline_exempt(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 133 | `is_product_support_assignee(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 134 | `is_staff()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 135 | `is_support_member(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 136 | `is_support_operator(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 137 | `list_account_auction_bid_states()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 138 | `list_my_security_log_access_requests()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 139 | `list_owner_operator_delegation_targets()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 140 | `list_support_operators()` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 141 | `manage_member_sanction(text,uuid,uuid,timestamp with time zone,timestamp with time zone,text)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 142 | `manage_owner_fulfillment_group(uuid,text,uuid[],text,bigint,uuid,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 143 | `manage_owner_store(text,uuid,uuid,text,text,text,uuid,bigint,uuid,text)` | N | Y | Y | N | `KEEP_GUARDED_DELEGATE` |
| 144 | `manage_past_auction_products(uuid[],text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 145 | `mark_support_conversation_read(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 146 | `open_inventory_exception(uuid,text,text,text,timestamp with time zone,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 147 | `operator_process_second_chance(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 148 | `owner_begin_hidden_test_manual_transfer(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 149 | `owner_close_auction_now(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 150 | `owner_create_ip_block_rule(text,text,text,text,timestamp with time zone)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 151 | `owner_decide_security_log_access(uuid,boolean,text,integer)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 152 | `owner_delete_hidden_test_shipping_address(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 153 | `owner_list_ip_block_rules(text,boolean)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 154 | `owner_list_security_activity(text,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 155 | `owner_list_security_log_access_requests(text,text,uuid,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 156 | `owner_list_security_session_history(uuid,text,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 157 | `owner_list_security_sessions(text,uuid,text,text,integer,integer)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 158 | `owner_override_auction_price(uuid,bigint,bigint,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 159 | `owner_place_test_bid(uuid,bigint,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 160 | `owner_set_account_nickname(uuid,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 161 | `owner_set_hidden_test_shipping_credits(integer)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 162 | `owner_update_hidden_test_member_profile(text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 163 | `owner_update_ip_block_rule(uuid,text,text,text,text,boolean,text,boolean,timestamp with time zone,boolean,boolean)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 164 | `owner_upsert_hidden_test_shipping_address(uuid,text,text,text,text,boolean)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 165 | `pack_inventory_shipment(uuid,bigint,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 166 | `pause_managed_product(uuid,timestamp with time zone)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 167 | `place_bid(uuid,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 168 | `prepare_managed_member_deletion(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 169 | `protect_owner_auth_update()` | N | Y | N | N | `REVOKE_INTERNAL_TRIGGER` |
| 170 | `protect_owner_kakao_identity_delete()` | N | Y | N | N | `REVOKE_INTERNAL_TRIGGER` |
| 171 | `protect_owner_kakao_identity_update()` | N | Y | N | N | `REVOKE_INTERNAL_TRIGGER` |
| 172 | `publish_pending_products_now(uuid[])` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 173 | `purge_deleted_member_record(uuid,text)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 174 | `queue_test_web_push_notification()` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 175 | `quote_commerce_shipping_fee(uuid[])` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 176 | `reconcile_inventory_item_route(uuid,bigint,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 177 | `record_center_item_action(uuid,bigint,text,uuid,text,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 178 | `record_manual_refund_account_access(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 179 | `record_manual_transfer_payment(text,uuid,bigint,text,bigint,integer,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 180 | `record_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 181 | `record_shipping_fee_refund_account_access(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 182 | `refresh_support_conversation_summary()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 183 | `reject_owner_store_service_plan(uuid,text,bigint)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 184 | `release_buyer_inventory_shipment_items(uuid,uuid[],bigint,uuid,text)` | N | Y | N | N | `KEEP_GUARDED_DELEGATE` |
| 185 | `release_buyer_paid_inventory_items(uuid[],bigint[],uuid,text)` | N | Y | N | N | `KEEP_GUARDED_DELEGATE` |
| 186 | `release_my_cart_reservation(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 187 | `reopen_support_conversation(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 188 | `request_commerce_cancellation(uuid,text,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 189 | `request_commerce_payment_confirmation(uuid,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 190 | `request_inventory_shipment(uuid[],uuid,text,bigint,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 191 | `request_legacy_order_shipment(uuid,uuid,boolean,uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 192 | `request_my_nickname_change(text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 193 | `request_my_shipping_credit_payment(integer,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 194 | `request_security_log_access(text,timestamp with time zone,timestamp with time zone,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 195 | `request_store_service_plan(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 196 | `require_active_operator_store_scope()` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 197 | `reserve_fixed_product_for_cart(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 198 | `reserve_gemini_product_enhancement_quota()` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 199 | `reserve_store_ai_quota(uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 200 | `reserve_store_automation_upload(uuid,text,text,integer,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 201 | `resolve_inventory_exception(uuid,bigint,text,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 202 | `resolve_product_inquiry_operator()` | N | Y | N | N | `REVOKE_INTERNAL_TRIGGER` |
| 203 | `respond_commerce_cancellation(uuid,boolean,bigint,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 204 | `respond_security_log_subject_consent(uuid,boolean,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 205 | `retry_withdrawn_member_cleanup(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 206 | `reveal_inventory_shipment_address(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 207 | `reveal_owner_store_payout_account(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 208 | `reverse_manual_transfer_payment(text,uuid,uuid,bigint,integer,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 209 | `reverse_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 210 | `review_manual_refund(uuid,bigint,text,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 211 | `review_nickname_change_request(uuid,boolean,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 212 | `review_shipping_fee_refund(uuid,bigint,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 213 | `revise_inventory_shipment_tracking(uuid,bigint,text,text,text,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 214 | `revoke_security_log_access(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 215 | `route_backlog_after_operator_promotion()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 216 | `send_onboarding_message(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 217 | `set_active_operator_store_scope(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 218 | `set_managed_member_status(uuid,text,timestamp with time zone,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 219 | `set_managed_staff_role(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 220 | `set_member_access_role(uuid,text)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 221 | `set_member_account_status(uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 222 | `set_my_initial_nickname(text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 223 | `set_operator_product_publication_preference(uuid,text,integer)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 224 | `set_owner_store_employee(uuid,uuid,boolean,bigint,bigint,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 225 | `set_owner_store_operator(uuid,uuid,boolean,bigint,bigint,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 226 | `set_site_status(text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 227 | `set_store_membership_access(uuid,bigint,uuid,text,jsonb,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 228 | `ship_inventory_shipment(uuid,bigint,text,text,uuid,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 229 | `start_onboarding_conversation(text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 230 | `start_product_inquiry(uuid,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 231 | `submit_manual_refund_account(uuid,text,text,text,integer,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 232 | `submit_shipping_fee_refund_account(uuid,text,text,text,integer,text,text,uuid)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 233 | `submit_store_payout_account(uuid,text,text,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 234 | `support_access_role(uuid)` | N | Y | N | Y | `KEEP_GUARDED_READ` |
| 235 | `support_employee_operator(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 236 | `support_store_operator(uuid)` | N | Y | N | N | `KEEP_POLICY_HELPER` |
| 237 | `sync_access_role_to_auth_metadata()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 238 | `sync_auth_user_profile()` | N | Y | Y | N | `REVOKE_INTERNAL_TRIGGER` |
| 239 | `touch_my_last_seen()` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 240 | `update_managed_member(uuid,text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 241 | `update_manual_transfer_settings(text,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 242 | `update_operator_product(uuid,timestamp with time zone,text,text,text,text,uuid,text,bigint,bigint,timestamp with time zone,text[],text[],text,text,text,jsonb,text[])` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 243 | `upsert_daily_revenue(date,bigint,integer)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 244 | `upsert_my_shipping_address(uuid,text,text,text,text,boolean,text)` | N | Y | Y | Y | `KEEP_GUARDED_MUTATION` |
| 245 | `validate_operator_account_user()` | N | Y | N | N | `REVOKE_INTERNAL_TRIGGER` |
| 246 | `validate_support_assignment()` | N | Y | N | N | `REVOKE_INTERNAL_TRIGGER` |

`guard 토큰=N`인 유지 함수는 위임 대상의 guard, 역할 helper 또는 제한된 읽기 계약을 별도로 확인했다. 단순 문자열 탐지 결과만으로 승인하지 않았다. 최종 catalog 검증은 public authenticated SECURITY DEFINER 230개, authenticated trigger 0개, `cancel_member_active_bids` authenticated/anon EXECUTE false다.


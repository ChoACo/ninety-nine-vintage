import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("support authorization helpers are executable only by authenticated users", async () => {
  const migration = await source(
    "supabase/migrations/20260725073000_lock_down_support_authorization_helpers.sql",
  );

  for (const helper of [
    "can_access_support_conversation",
    "can_send_support_message",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${helper}\\(uuid\\)[\\s\\S]*from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${helper}\\(uuid\\)[\\s\\S]*to authenticated`,
        "i",
      ),
    );
  }
});

test("support chat is scoped to one member room per active store", async () => {
  const [migration, memberRoute, operatorRoute] = await Promise.all([
    source("supabase/migrations/20260724093922_store_scoped_support_chat.sql"),
    source("src/app/api/chat/route.ts"),
    source("src/app/api/admin/operator/chat/route.ts"),
  ]);

  assert.match(migration, /add column if not exists store_id uuid/);
  assert.match(
    migration,
    /support_conversations_member_store_uidx[\s\S]*member_id, store_id/,
  );
  assert.match(
    migration,
    /create or replace function public\.support_store_operator/,
  );
  assert.match(
    migration,
    /get_or_create_operator_store_conversation/,
  );
  assert.match(memberRoute, /get_or_create_support_conversation/);
  assert.match(memberRoute, /p_store_id: body\.storeId/);
  assert.match(operatorRoute, /get_or_create_operator_store_conversation/);
  assert.match(operatorRoute, /assigned_staff_id/);
});

test("product inquiries become product-attached messages in the product store room", async () => {
  const [migration, modal, panel] = await Promise.all([
    source("supabase/migrations/20260724093922_store_scoped_support_chat.sql"),
    source(
      "src/components/features/auction/detail/ProductInquiryModal.tsx",
    ),
    source("src/components/features/chat/ChatPanel.tsx"),
  ]);

  assert.match(
    migration,
    /insert into public\.support_messages[\s\S]*product_id[\s\S]*product_title_snapshot/,
  );
  assert.match(
    migration,
    /public\.support_store_operator\(products\.store_id\)/,
  );
  assert.match(modal, /productId/);
  assert.match(modal, /conversationId/);
  assert.match(panel, /item\.product_id/);
  assert.match(panel, /상품 문의/);
});

test("member and operator surfaces expose store selection and direct member chat", async () => {
  const [memberPanel, operatorPanel, storagePanel, operatorLayout, localAccounts] =
    await Promise.all([
      source("src/components/features/chat/ChatPanel.tsx"),
      source("src/components/admin/operator/OperatorChatConsole.tsx"),
      source(
        "src/components/admin/operator/OperatorMemberOperationsConsole.tsx",
      ),
      source("src/app/(admin)/admin/operator/layout.tsx"),
      source("src/app/api/local-test-accounts/route.ts"),
    ]);

  assert.match(memberPanel, /매장별 상담/);
  assert.match(memberPanel, /selectStore/);
  assert.match(operatorPanel, /memberId/);
  assert.match(operatorPanel, /storeId/);
  assert.match(storagePanel, /채팅하기/);
  assert.match(storagePanel, /\/admin\/operator\/chat\?memberId=/);
  assert.match(operatorLayout, /회원 채팅/);
  assert.match(localAccounts, /slot === "operator-secondary" \? 1 : 0/);
});

test("employees can handle only their assigned store chats and receive role-correct links", async () => {
  const [migration, operatorRoute, employeePage, unreadRoute] =
    await Promise.all([
      source(
        "supabase/migrations/20260725053459_fix_employee_internal_chat_and_notifications.sql",
      ),
      source("src/app/api/admin/operator/chat/route.ts"),
      source("src/app/(admin)/admin/employee/inquiries/page.tsx"),
      source("src/app/api/chat/unread/route.ts"),
    ]);

  assert.match(
    migration,
    /support_access_role\(auth\.uid\(\)\) = 'employee'[\s\S]*store_memberships/,
  );
  assert.match(
    migration,
    /create policy "Users read their notifications"[\s\S]*member_id = \(select auth\.uid\(\)\)/,
  );
  assert.match(migration, /\/admin\/employee\/inquiries/);
  assert.match(operatorRoute, /auth\.effectiveOperatorId/);
  assert.match(operatorRoute, /\.in\("conversation_type", \["general", "product", "internal"\]\)/);
  assert.match(employeePage, /basePath="\/admin\/employee\/inquiries"/);
  assert.match(unreadRoute, /roleCode === "employee"/);
  assert.match(unreadRoute, /\/admin\/employee\/inquiries\?conversationId=/);
});

test("realtime chat events render an unread badge and dismissible five-second toast", async () => {
  const [
    chatProvider,
    notificationProvider,
    rootLayout,
    desktopHeader,
    mobileHeader,
    adminLayout,
  ] =
    await Promise.all([
      source(
        "src/components/features/chat/ChatNotificationProvider.tsx",
      ),
      source(
        "src/components/features/notifications/NotificationExperienceProvider.tsx",
      ),
      source("src/app/layout.tsx"),
      source("src/components/layout/PcHeader.tsx"),
      source("src/components/mobile/MobileSiteHeader.tsx"),
      source("src/app/(admin)/admin/layout.tsx"),
    ]);

  assert.match(chatProvider, /postgres_changes/);
  assert.match(chatProvider, /table: "support_messages"/);
  assert.match(chatProvider, /unreadCount/);
  assert.match(notificationProvider, /table: "notifications"/);
  assert.match(notificationProvider, /5_000/);
  assert.match(notificationProvider, /알림 닫기/);
  assert.match(notificationProvider, /관련 화면으로 이동/);
  assert.match(rootLayout, /NotificationExperienceProvider/);
  assert.match(rootLayout, /ChatNotificationProvider/);
  assert.match(desktopHeader, /ChatNotificationLink/);
  assert.match(mobileHeader, /ChatNotificationLink/);
  assert.match(adminLayout, /ChatNotificationLink/);
});

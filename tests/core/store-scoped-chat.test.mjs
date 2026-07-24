import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

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

test("realtime chat events render an unread badge and dismissible five-second toast", async () => {
  const [provider, rootLayout, desktopHeader, mobileHeader, adminLayout] =
    await Promise.all([
      source(
        "src/components/features/chat/ChatNotificationProvider.tsx",
      ),
      source("src/app/layout.tsx"),
      source("src/components/layout/PcHeader.tsx"),
      source("src/components/mobile/MobileSiteHeader.tsx"),
      source("src/app/(admin)/admin/layout.tsx"),
    ]);

  assert.match(provider, /postgres_changes/);
  assert.match(provider, /table: "support_messages"/);
  assert.match(provider, /새로운 채팅이 있습니다/);
  assert.match(provider, /5_000/);
  assert.match(provider, /새 채팅 알림 닫기/);
  assert.match(provider, /채팅으로 이동하기/);
  assert.match(provider, /unreadCount/);
  assert.match(rootLayout, /ChatNotificationProvider/);
  assert.match(desktopHeader, /ChatNotificationLink/);
  assert.match(mobileHeader, /ChatNotificationLink/);
  assert.match(adminLayout, /ChatNotificationLink/);
});

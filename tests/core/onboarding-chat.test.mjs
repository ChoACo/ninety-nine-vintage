import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("onboarding chat uses a separate owner-only ledger with approved FAQ reads", async () => {
  const migration = await source(
    "supabase/migrations/20260809173604_add_owner_onboarding_chat.sql",
  );

  assert.match(migration, /create table public\.onboarding_faq_entries/);
  assert.match(migration, /create table public\.onboarding_conversations/);
  assert.match(migration, /create table public\.onboarding_messages/);
  assert.doesNotMatch(migration, /support_conversations/);
  assert.match(
    migration,
    /Users read approved onboarding FAQs[\s\S]*is_approved or public\.is_owner\(\)/,
  );
  assert.match(
    migration,
    /Participants read onboarding conversations[\s\S]*member_id=auth\.uid\(\) or public\.is_owner\(\)/,
  );
  assert.match(migration, /unique\(sender_id,client_nonce\)/);
  assert.match(
    migration,
    /select \* into v_message[\s\S]*sender_id=v_actor and client_nonce=p_client_nonce[\s\S]*if found then return/,
  );
});

test("onboarding surfaces keep applicant and owner views separate and retry one nonce", async () => {
  const [route, panel, ownerPage, ownerLayout] = await Promise.all([
    source("src/app/api/onboarding-chat/route.ts"),
    source("src/components/features/chat/OnboardingChatPanel.tsx"),
    source("src/app/(admin)/admin/owner/onboarding/page.tsx"),
    source("src/app/(admin)/admin/owner/layout.tsx"),
  ]);

  assert.match(route, /\.eq\("is_approved",true\)/);
  assert.match(route, /start_onboarding_conversation/);
  assert.match(route, /send_onboarding_message/);
  assert.doesNotMatch(route, /support_conversations/);
  assert.match(panel, /nonce \?\? crypto\.randomUUID\(\)/);
  assert.match(panel, /같은 내용 재전송/);
  assert.match(panel, /ownerView[\s\S]*입점 신청자[\s\S]*관리자/);
  assert.match(ownerPage, /audience="owner"/);
  assert.match(ownerLayout, /\/admin\/owner\/onboarding/);
});

test("product chat is visible to both participants without leaking internal inquiry errors", async () => {
  const [memberRoute, operatorRoute] = await Promise.all([
    source("src/app/api/chat/route.ts"),
    source("src/app/api/admin/operator/chat/route.ts"),
  ]);

  assert.match(
    memberRoute,
    /\.in\("conversation_type", \["general", "product"\]\)/,
  );
  assert.match(
    operatorRoute,
    /\.in\("conversation_type", \["general", "product", "internal"\]\)/,
  );
  assert.doesNotMatch(memberRoute, /product_inquiry_failed/);
  assert.match(memberRoute, /이 상품에는 문의를 보낼 수 없습니다/);
  assert.match(memberRoute, /peer_read_at/);
});

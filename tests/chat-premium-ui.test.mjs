import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

const quickQuestions = [
  "실측 사이즈가 궁금해요",
  "오염이나 하자가 있나요?",
  "계좌이체 입금 완료했습니다",
];

test("keeps the operator inbox filters live while adding a premium workspace shell", async () => {
  const staffInbox = await source("src/components/chat/StaffChatInbox.tsx");

  assert.match(staffInbox, /const filterCounts = useMemo/);
  assert.match(staffInbox, /all: chat\.conversations\.length/);
  assert.match(
    staffInbox,
    /unread: chat\.conversations\.filter\(\(conversation\) => conversation\.isUnread\)\.length/,
  );
  assert.match(
    staffInbox,
    /open: chat\.conversations\.filter\(\(conversation\) => conversation\.status === "open"\)\.length/,
  );
  assert.match(
    staffInbox,
    /closed: chat\.conversations\.filter\(\(conversation\) => conversation\.status === "closed"\)\.length/,
  );
  assert.match(staffInbox, /filterCounts\[item\.value\]\.toLocaleString\("ko-KR"\)/);
  assert.match(staffInbox, /filterCounts\.unread > 0[\s\S]*motion-safe:animate-pulse/);

  assert.match(staffInbox, /const searchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(
    staffInbox,
    /\(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*event\.preventDefault\(\)[\s\S]*searchInputRef\.current\?\.focus\(\)/,
  );
  assert.match(
    staffInbox,
    /event\.key === "Escape" && isMobileConversationOpen[\s\S]*setIsMobileConversationOpen\(false\)/,
  );
  assert.match(staffInbox, /aria-keyshortcuts="Control\+K Meta\+K"/);

  assert.match(staffInbox, /data-support-workspace-placeholder/);
  assert.match(staffInbox, /운영자 상담 가이드/);
  assert.match(
    staffInbox,
    /data-support-conversation-header[\s\S]*sticky[\s\S]*top-0/,
  );
  assert.match(staffInbox, /data-support-product-context/);
  assert.match(staffInbox, /productImageUrlSnapshot/);
  assert.match(staffInbox, /productTitleSnapshot/);

  // The established search, selection, read, status, and mobile navigation
  // contracts remain wired beneath the new presentation layer.
  assert.match(
    staffInbox,
    /memberName\.toLocaleLowerCase\("ko-KR"\)\.includes\(normalizedQuery\)/,
  );
  assert.match(
    staffInbox,
    /conversation\.lastMessagePreview[\s\S]*\.includes\(normalizedQuery\)/,
  );
  assert.match(
    staffInbox,
    /chat\.selectConversation\(conversation\.id\);\s*setIsMobileConversationOpen\(true\)/,
  );
  assert.match(staffInbox, /if \(!selectedConversationId\) return;\s*void markRead\(\)/);
  assert.match(
    staffInbox,
    /void chat\.changeConversation\(\{[\s\S]*status:[\s\S]*"closed" : "open"/,
  );
});

test("offers the same honest one-click member questions and KST date dividers in both chat surfaces", async () => {
  const surfaces = await Promise.all([
    source("src/components/chat/ChatPage.tsx"),
    source("src/components/chat/FloatingAdminChat.tsx"),
  ]);

  for (const chatSurface of surfaces) {
    for (const question of quickQuestions) {
      assert.match(chatSurface, new RegExp(question.replace(/[?]/g, "\\?")));
    }

    assert.match(chatSurface, /data-support-quick-question/);
    assert.match(chatSurface, /type="button"/);
    assert.match(chatSurface, /chat\.sendMessage\(question\)/);
    assert.match(chatSurface, /isClosed \|\| chat\.isSending/);
    assert.match(chatSurface, /getKoreanDateKey\(message\.createdAt\)/);
    assert.match(chatSurface, /formatKoreanDate\(message\.createdAt/);
    assert.match(chatSurface, /data-chat-date-divider/);
    assert.match(chatSurface, /font-mono[^"]*tabular-nums[^"]*tracking-tight/);

    // There is no attachment, per-user presence, or price field in the support
    // message contract. The UI must not advertise controls it cannot execute.
    assert.doesNotMatch(chatSurface, /type="file"|accept="image\/\*"/);
    assert.doesNotMatch(chatSurface, /data-support-online-status|data-support-price/);
  }

  assert.match(surfaces[0], /if \(internal \|\| isClosed \|\| chat\.isSending\) return/);
  assert.match(surfaces[0], /\{!internal \? \([\s\S]*data-support-quick-question/);
  assert.match(surfaces[1], /if \(isClosed \|\| chat\.isSending\) return/);
});

test("preserves member submit, read, scroll, reopen, and floating Escape behavior", async () => {
  const [memberPage, floatingChat] = await Promise.all([
    source("src/components/chat/ChatPage.tsx"),
    source("src/components/chat/FloatingAdminChat.tsx"),
  ]);

  for (const chatSurface of [memberPage, floatingChat]) {
    assert.match(
      chatSurface,
      /const handleSend = async \(event: FormEvent<HTMLFormElement>\) => \{\s*event\.preventDefault\(\);\s*const text = draft\.trim\(\);\s*if \(!text \|\| chat\.isSending\) return/,
    );
    assert.match(
      chatSurface,
      /await chat\.sendMessage\(text\);\s*setDraft\(""\)/,
    );
    assert.match(
      chatSurface,
      /const element = messagesRef\.current;\s*if \(element\) element\.scrollTop = element\.scrollHeight/,
    );
    assert.match(chatSurface, /void markRead\(\)/);
    assert.match(
      chatSurface,
      /onClick=\{\(\) => void chat\.reopenConversation\(\)\}/,
    );
  }

  assert.match(
    floatingChat,
    /if \(event\.key === "Escape"\) onClose\(\)/,
  );
  assert.match(
    floatingChat,
    /window\.addEventListener\("keydown", closeOnEscape\)[\s\S]*window\.removeEventListener\("keydown", closeOnEscape\)/,
  );
});

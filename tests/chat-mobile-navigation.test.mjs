import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staffInboxUrl = new URL(
  "../src/components/chat/StaffChatInbox.tsx",
  import.meta.url,
);

test("staff inbox swaps the list and conversation below the tablet breakpoint", async () => {
  const source = await readFile(staffInboxUrl, "utf8");

  assert.match(
    source,
    /const \[isMobileConversationOpen, setIsMobileConversationOpen\] = useState\(false\)/,
  );
  assert.match(
    source,
    /chat\.selectConversation\(conversation\.id\);\s*setIsMobileConversationOpen\(true\)/,
  );
  assert.match(source, /hidden md:block/);
  assert.match(source, /md:flex/);
  assert.match(source, /aria-label="상담 목록으로 돌아가기"/);
  assert.match(source, /onClick=\{\(\) => setIsMobileConversationOpen\(false\)\}/);
  assert.match(source, /md:grid-cols-/);
});

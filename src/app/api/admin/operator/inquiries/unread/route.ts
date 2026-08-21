import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

interface ConversationSummary {
  id: string;
  last_message_at: string | null;
  last_sender_id: string | null;
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ count: 0, href: null }, 200);
  }

  const selectedStoreId = "selectedStoreId" in auth &&
    typeof auth.selectedStoreId === "string"
    ? auth.selectedStoreId
    : null;
  const scopedOperatorId = auth.effectiveOperatorId ?? auth.userId;

  let query = (auth.roleCode === "owner" ? auth.admin : auth.user)
    .from("support_conversations")
    .select("id, last_message_at, last_sender_id")
    .eq("conversation_type", "product")
    .not("last_message_at", "is", null);
  if (selectedStoreId) query = query.eq("store_id", selectedStoreId);
  const { data: conversations, error } =
    auth.roleCode === "owner"
      ? await query
      : await query.eq("assigned_staff_id", scopedOperatorId);
  if (error) {
    return commerceJson({ count: 0, href: null }, 200);
  }

  const { data: reads } = await auth.user
    .from("support_reads")
    .select("conversation_id, last_read_at")
    .eq("user_id", auth.effectiveUserId);
  const readAtByConversation = new Map(
    (reads ?? []).map((receipt) => [
      receipt.conversation_id,
      receipt.last_read_at,
    ]),
  );

  const unread = ((conversations ?? []) as ConversationSummary[]).filter(
    (conversation) => {
      if (!conversation.last_message_at) return false;
      if (conversation.last_sender_id === auth.effectiveUserId) return false;
      const lastMessageAt = new Date(conversation.last_message_at).getTime();
      const lastReadAtRaw = readAtByConversation.get(conversation.id);
      const lastReadAt = lastReadAtRaw
        ? new Date(lastReadAtRaw).getTime()
        : 0;
      return (
        Number.isFinite(lastMessageAt) &&
        (!Number.isFinite(lastReadAt) || lastMessageAt > lastReadAt)
      );
    },
  );

  return commerceJson({
    count: unread.length,
    href: "/admin/operator/inquiries",
  });
}
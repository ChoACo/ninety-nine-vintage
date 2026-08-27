import {
  authenticateCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

interface ConversationSummary {
  id: string;
  member_id: string;
  assigned_staff_id: string | null;
  store_id: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
}

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const [{ data: role }, { data: memberAccount }] = await Promise.all([
    auth.admin
      .from("account_access_roles")
      .select("role_code, reports_to_operator_id")
      .eq("user_id", auth.userId)
      .maybeSingle(),
    auth.admin
      .from("member_accounts")
      .select("member_id, account_status")
      .eq("member_id", auth.userId)
      .eq("account_status", "active")
      .maybeSingle(),
  ]);

  const roleCode = role?.role_code ?? (memberAccount ? "member" : null);
  let query = auth.user
    .from("support_conversations")
    .select(
      "id, member_id, assigned_staff_id, store_id, last_message_at, last_sender_id",
    )
    .not("last_message_at", "is", null);

  if (roleCode === "member") {
    query = query
      .eq("member_id", auth.userId)
      .in("conversation_type", ["general", "product"]);
  } else if (roleCode === "owner") {
    const { data: selectedStoreId, error: scopeError } = await auth.user.rpc(
      "require_active_operator_store_scope",
    );
    if (scopeError || typeof selectedStoreId !== "string") {
      return commerceJson({
        unreadCount: 0,
        latestConversationId: null,
        latestMessageAt: null,
        href: "/admin/operator/chat",
      });
    }
    query = query
      .eq("store_id", selectedStoreId)
      .in("conversation_type", ["general", "product", "internal"]);
  } else if (roleCode === "operator") {
    query = query
      .eq("assigned_staff_id", auth.userId)
      .in("conversation_type", ["general", "internal"]);
  } else if (roleCode === "employee" && role?.reports_to_operator_id) {
    query = query.in("conversation_type", ["general", "internal"]);
  } else {
    return commerceJson({
      unreadCount: 0,
      latestConversationId: null,
      latestMessageAt: null,
      href: null,
    });
  }

  const [{ data: conversations, error }, { data: reads }] = await Promise.all([
    query.order("last_message_at", { ascending: false }),
    auth.user
      .from("support_reads")
      .select("conversation_id, last_read_at")
      .eq("user_id", auth.userId),
  ]);
  if (error) {
    return commerceJson(
      { error: "chat_unread_unavailable", message: error.message },
      503,
    );
  }

  const readAtByConversation = new Map(
    (reads ?? []).map((receipt) => [
      receipt.conversation_id,
      receipt.last_read_at,
    ]),
  );
  const unread = ((conversations ?? []) as ConversationSummary[]).filter(
    (conversation) => {
      if (
        !conversation.last_message_at ||
        conversation.last_sender_id === auth.userId
      ) {
        return false;
      }
      const readAt = readAtByConversation.get(conversation.id);
      if (!readAt) return true;
      const lastMessageAt = new Date(conversation.last_message_at).getTime();
      const lastReadAt = new Date(readAt).getTime();
      return Number.isFinite(lastMessageAt) &&
        (!Number.isFinite(lastReadAt) || lastMessageAt > lastReadAt);
    },
  );
  const latest = unread[0] ?? null;

  return commerceJson({
    unreadCount: unread.length,
    latestConversationId: latest?.id ?? null,
    latestMessageAt: latest?.last_message_at ?? null,
    href:
      roleCode === "owner" || roleCode === "operator"
        ? latest
          ? `/admin/operator/chat?storeId=${encodeURIComponent(latest.store_id ?? "")}&conversationId=${encodeURIComponent(latest.id)}`
          : "/admin/operator/chat"
        : roleCode === "employee"
          ? latest
            ? `/admin/employee/inquiries?conversationId=${encodeURIComponent(latest.id)}`
            : "/admin/employee/inquiries"
        : latest
          ? `/chat?conversationId=${encodeURIComponent(latest.id)}`
          : "/chat",
  });
}

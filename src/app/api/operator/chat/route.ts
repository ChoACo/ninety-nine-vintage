import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const query = auth.admin
    .from("support_conversations")
    .select("id, member_id, assigned_staff_id, status, subject, conversation_type, product_id, last_message_at, last_message_preview, created_at")
    .neq("conversation_type", "internal")
    .order("last_message_at", { ascending: false, nullsFirst: false });
  const { data: conversations, error } = auth.roleCode === "owner"
    ? await query
    : await query.eq("assigned_staff_id", auth.userId);
  if (error) return commerceJson({ error: "operator_chat_unavailable" }, 503);
  const memberIds = [...new Set((conversations ?? []).map((conversation) => conversation.member_id))];
  const { data: members } = memberIds.length === 0
    ? { data: [] }
    : await auth.admin.from("profiles").select("id, display_name").in("id", memberIds);
  return commerceJson({ conversations: conversations ?? [], members: members ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode === "owner") return commerceJson({ error: "owner_chat_read_only" }, 403);
  const body = await request.json().catch(() => null) as { conversationId?: string; body?: string; clientNonce?: string } | null;
  const messageBody = body?.body?.trim();
  if (!body?.conversationId || !messageBody || messageBody.length > 2000) return commerceJson({ error: "메시지를 확인해 주세요." }, 400);
  const { data: conversation } = await auth.admin
    .from("support_conversations")
    .select("id, assigned_staff_id")
    .eq("id", body.conversationId)
    .maybeSingle();
  if (!conversation || conversation.assigned_staff_id !== auth.userId) return commerceJson({ error: "담당 상담만 답변할 수 있습니다." }, 403);
  const { data: message, error } = await auth.admin
    .from("support_messages")
    .insert({ conversation_id: conversation.id, body: messageBody, client_nonce: body.clientNonce?.trim() || crypto.randomUUID(), sender_id: auth.userId })
    .select("*")
    .single();
  if (error) return commerceJson({ error: error.message || "메시지를 보내지 못했습니다." }, 409);
  return commerceJson({ message }, 201);
}

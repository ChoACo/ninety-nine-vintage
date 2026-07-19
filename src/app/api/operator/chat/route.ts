import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const query = auth.roleCode === "owner"
    ? auth.admin.from("support_conversations").select("*")
    : auth.admin.from("support_conversations").select("*").eq("assigned_staff_id", auth.userId);
  const { data, error } = await query.order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
  if (error) return commerceJson({ error: "operator_chat_unavailable" }, 503);
  return commerceJson({ conversations: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { conversationId?: string; body?: string; clientNonce?: string } | null;
  if (!body?.conversationId || !body.body?.trim()) return commerceJson({ error: "메시지를 확인해 주세요." }, 400);
  const { data, error } = await auth.user.from("support_messages").insert({
    conversation_id: body.conversationId,
    body: body.body.trim().slice(0, 4000),
    client_nonce: body.clientNonce?.trim() || crypto.randomUUID(),
    sender_id: auth.userId,
  }).select("*").single();
  if (error) return commerceJson({ error: error.message || "메시지를 보내지 못했습니다." }, 409);
  return commerceJson({ message: data }, 201);
}

import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (conversationId) {
    const { data: conversation, error: conversationError } = await auth.user.from("support_conversations").select("*").eq("id", conversationId).maybeSingle();
    if (conversationError || !conversation) return commerceJson({ error: "conversation_not_found" }, 404);
    const { data: messages, error: messageError } = await auth.user.from("support_messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
    if (messageError) return commerceJson({ error: "chat_unavailable" }, 503);
    return commerceJson({ conversation, messages: messages ?? [] });
  }
  const { data: conversations, error: conversationError } = await auth.user.rpc("get_or_create_support_conversation");
  if (conversationError) return commerceJson({ error: "chat_unavailable" }, 503);
  const conversation = Array.isArray(conversations) ? conversations[0] : conversations;
  if (!conversation) return commerceJson({ conversation: null, messages: [] });
  const { data: messages, error: messageError } = await auth.user
    .from("support_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (messageError) return commerceJson({ error: "chat_unavailable" }, 503);
  return commerceJson({ conversation, messages: messages ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as {
    conversationId?: string;
    body?: string;
    clientNonce?: string;
  } | null;
  const messageBody = body?.body?.trim();
  if (!messageBody || messageBody.length > 4000) return commerceJson({ error: "메시지를 확인해 주세요." }, 400);
  let conversationId = body?.conversationId;
  if (!conversationId) {
    const { data } = await auth.user.rpc("get_or_create_support_conversation");
    const conversation = Array.isArray(data) ? data[0] : data;
    conversationId = conversation?.id;
  }
  if (!conversationId) return commerceJson({ error: "상담방을 만들지 못했습니다." }, 503);
  const { data, error } = await auth.user
    .from("support_messages")
    .insert({
      conversation_id: conversationId,
      body: messageBody,
      client_nonce: body?.clientNonce?.trim() || crypto.randomUUID(),
      sender_id: auth.userId,
    })
    .select("*")
    .single();
  if (error) return commerceJson({ error: error.message || "메시지를 보내지 못했습니다." }, 409);
  return commerceJson({ message: data }, 201);
}

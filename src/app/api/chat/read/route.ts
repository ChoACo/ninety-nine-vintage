import {
  authenticateCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    conversationId?: string;
  } | null;
  if (!body?.conversationId || !UUID_PATTERN.test(body.conversationId)) {
    return commerceJson({ error: "읽을 채팅방을 선택해 주세요." }, 400);
  }

  const { data, error } = await auth.user.rpc(
    "mark_support_conversation_read",
    { p_conversation_id: body.conversationId },
  );
  if (error) {
    return commerceJson(
      { error: "chat_read_failed", message: error.message },
      error.code === "42501" ? 403 : 409,
    );
  }
  return commerceJson({ read: true, receipt: data?.[0] ?? null });
}

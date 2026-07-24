import {
  authenticateMemberCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (conversationId) {
    if (!isUuid(conversationId)) {
      return commerceJson({ error: "conversation_not_found" }, 404);
    }
    const { data: conversation, error: conversationError } = await auth.user
      .from("support_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError || !conversation) {
      return commerceJson({ error: "conversation_not_found" }, 404);
    }
    const { data: messages, error: messageError } = await auth.user
      .from("support_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (messageError) {
      return commerceJson(
        {
          error: "chat_unavailable",
          message: messageError.message,
        },
        503,
      );
    }
    return commerceJson({ conversation, messages: messages ?? [] });
  }

  const [storeResult, conversationResult] = await Promise.all([
    auth.admin
      .from("stores")
      .select("id, name, slug, operator_id")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    auth.user
      .from("support_conversations")
      .select("*")
      .eq("member_id", auth.userId)
      .eq("conversation_type", "general")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  if (storeResult.error || conversationResult.error) {
    return commerceJson(
      {
        error: "chat_unavailable",
        message:
          storeResult.error?.message ??
          conversationResult.error?.message ??
          "매장 상담 목록을 불러오지 못했습니다.",
      },
      503,
    );
  }

  return commerceJson({
    stores: storeResult.data ?? [],
    conversations: conversationResult.data ?? [],
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    action?: "ensure";
    conversationId?: string;
    storeId?: string;
    productId?: string;
    body?: string;
    clientNonce?: string;
  } | null;

  if (body?.action === "ensure") {
    if (!isUuid(body.storeId)) {
      return commerceJson({ error: "문의할 매장을 선택해 주세요." }, 400);
    }
    const { data, error } = await auth.user.rpc(
      "get_or_create_support_conversation",
      { p_store_id: body.storeId },
    );
    const conversation = Array.isArray(data) ? data[0] : data;
    if (error || !conversation) {
      return commerceJson(
        {
          error: "conversation_create_failed",
          message: error?.message ?? "매장 상담방을 만들지 못했습니다.",
        },
        error?.code === "42501" ? 403 : 409,
      );
    }
    return commerceJson({ conversation }, 201);
  }

  const messageBody = body?.body?.trim();
  if (!messageBody || messageBody.length > 2_000) {
    return commerceJson({ error: "메시지를 확인해 주세요." }, 400);
  }

  if (body?.productId) {
    if (!isUuid(body.productId)) {
      return commerceJson({ error: "문의할 상품을 확인해 주세요." }, 400);
    }
    const clientNonce = body.clientNonce?.trim() || crypto.randomUUID();
    const { data, error } = await auth.user.rpc("start_product_inquiry", {
      p_body: messageBody,
      p_client_nonce: clientNonce,
      p_product_id: body.productId,
    });
    const conversation = Array.isArray(data) ? data[0] : data;
    if (error || !conversation) {
      return commerceJson(
        {
          error: "product_inquiry_failed",
          message: error?.message ?? "상품 문의를 보내지 못했습니다.",
        },
        error?.code === "42501" ? 403 : 409,
      );
    }
    return commerceJson({ conversation }, 201);
  }

  let conversationId = body?.conversationId;
  if (!conversationId && isUuid(body?.storeId)) {
    const { data, error } = await auth.user.rpc(
      "get_or_create_support_conversation",
      { p_store_id: body.storeId },
    );
    const conversation = Array.isArray(data) ? data[0] : data;
    if (error) {
      return commerceJson(
        {
          error: "conversation_create_failed",
          message: error.message,
        },
        error.code === "42501" ? 403 : 409,
      );
    }
    conversationId = conversation?.id;
  }
  if (!isUuid(conversationId)) {
    return commerceJson({ error: "상담할 매장을 선택해 주세요." }, 400);
  }

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
  if (error) {
    return commerceJson(
      {
        error: "message_send_failed",
        message: error.message || "메시지를 보내지 못했습니다.",
      },
      error.code === "42501" ? 403 : 409,
    );
  }
  return commerceJson({ message: data }, 201);
}

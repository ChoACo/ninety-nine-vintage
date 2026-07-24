import {
  authenticateStaffRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (conversationId) {
    if (!isUuid(conversationId)) {
      return commerceJson({ error: "conversation_not_found" }, 404);
    }
    const conversationQuery = auth.admin
      .from("support_conversations")
      .select("*")
      .eq("id", conversationId);
    const { data: conversation } =
      auth.roleCode === "owner"
        ? await conversationQuery.maybeSingle()
        : await conversationQuery
            .eq("assigned_staff_id", auth.userId)
            .maybeSingle();
    if (!conversation) {
      return commerceJson({ error: "conversation_not_found" }, 404);
    }
    const { data: messages, error: messageError } = await auth.user
      .from("support_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (messageError) {
      return commerceJson(
        { error: "operator_chat_unavailable", message: messageError.message },
        503,
      );
    }
    return commerceJson({ conversation, messages: messages ?? [] });
  }

  const query = auth.admin
    .from("support_conversations")
    .select(
      "id, member_id, assigned_staff_id, store_id, status, subject, conversation_type, product_id, last_message_at, last_message_preview, last_sender_id, created_at",
    )
    .eq("conversation_type", "general")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data: conversations, error } =
    auth.roleCode === "owner"
      ? await query
      : await query.eq("assigned_staff_id", auth.userId);
  if (error) {
    return commerceJson(
      { error: "operator_chat_unavailable", message: error.message },
      503,
    );
  }

  const memberIds = [
    ...new Set((conversations ?? []).map((conversation) => conversation.member_id)),
  ];
  const storeIds = [
    ...new Set(
      (conversations ?? [])
        .map((conversation) => conversation.store_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const [memberResult, storeResult] = await Promise.all([
    memberIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("profiles")
          .select("id, display_name")
          .in("id", memberIds),
    storeIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin.from("stores").select("id, name, slug").in("id", storeIds),
  ]);

  return commerceJson({
    conversations: conversations ?? [],
    members: memberResult.data ?? [],
    stores: storeResult.data ?? [],
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode === "owner") {
    return commerceJson({ error: "owner_chat_read_only" }, 403);
  }
  if (auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_chat_required" }, 403);
  }

  const body = (await request.json().catch(() => null)) as {
    action?: "ensure";
    memberId?: string;
    storeId?: string;
    conversationId?: string;
    body?: string;
    clientNonce?: string;
  } | null;

  if (body?.action === "ensure") {
    if (!isUuid(body.memberId) || !isUuid(body.storeId)) {
      return commerceJson({ error: "회원과 매장을 확인해 주세요." }, 400);
    }
    const { data, error } = await auth.user.rpc(
      "get_or_create_operator_store_conversation",
      {
        p_member_id: body.memberId,
        p_store_id: body.storeId,
      },
    );
    const conversation = Array.isArray(data) ? data[0] : data;
    if (error || !conversation) {
      return commerceJson(
        {
          error: "operator_chat_create_failed",
          message: error?.message ?? "회원 채팅방을 만들지 못했습니다.",
        },
        error?.code === "42501" ? 403 : 409,
      );
    }
    return commerceJson({ conversation }, 201);
  }

  const messageBody = body?.body?.trim();
  if (
    !isUuid(body?.conversationId) ||
    !messageBody ||
    messageBody.length > 2_000
  ) {
    return commerceJson({ error: "메시지를 확인해 주세요." }, 400);
  }
  const { data: conversation } = await auth.admin
    .from("support_conversations")
    .select("id, assigned_staff_id")
    .eq("id", body.conversationId)
    .maybeSingle();
  if (!conversation || conversation.assigned_staff_id !== auth.userId) {
    return commerceJson({ error: "담당 매장 상담만 답변할 수 있습니다." }, 403);
  }

  const { data: message, error } = await auth.user
    .from("support_messages")
    .insert({
      conversation_id: conversation.id,
      body: messageBody,
      client_nonce: body.clientNonce?.trim() || crypto.randomUUID(),
      sender_id: auth.userId,
    })
    .select("*")
    .single();
  if (error) {
    return commerceJson(
      { error: "message_send_failed", message: error.message },
      error.code === "42501" ? 403 : 409,
    );
  }
  return commerceJson({ message }, 201);
}

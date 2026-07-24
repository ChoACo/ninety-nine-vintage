import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { readWebPushPublicKey } from "@/lib/webPush/server";

interface SubscriptionPayload {
  endpoint?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
}

function normalizeSubscription(body: SubscriptionPayload) {
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const authSecret =
    typeof body.keys?.auth === "string" ? body.keys.auth.trim() : "";
  if (
    !endpoint.startsWith("https://") ||
    endpoint.length > 4096 ||
    p256dh.length < 32 ||
    p256dh.length > 1024 ||
    authSecret.length < 8 ||
    authSecret.length > 512
  ) {
    return null;
  }
  return { endpoint, p256dh, authSecret };
}

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const { count, error } = await auth.admin
      .from("web_push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.userId)
      .is("disabled_at", null);
    if (error) throw error;
    return commerceJson({
      enabled: (count ?? 0) > 0,
      publicKey: readWebPushPublicKey(),
    });
  } catch {
    return commerceJson(
      { error: "push_unavailable", message: "알림 설정을 확인하지 못했습니다." },
      503,
    );
  }
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as SubscriptionPayload | null;
  const subscription = body ? normalizeSubscription(body) : null;
  if (!subscription) {
    return commerceJson(
      { error: "invalid_subscription", message: "알림 구독 정보가 올바르지 않습니다." },
      400,
    );
  }

  const { error } = await auth.admin.from("web_push_subscriptions").upsert(
    {
      user_id: auth.userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth_secret: subscription.authSecret,
      user_agent: (request.headers.get("user-agent") ?? "").slice(0, 1024),
      failure_count: 0,
      disabled_at: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    return commerceJson(
      { error: "push_save_failed", message: "알림 구독을 저장하지 못했습니다." },
      503,
    );
  }
  return commerceJson({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as
    | { endpoint?: unknown }
    | null;
  const endpoint =
    typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 4096) {
    return commerceJson(
      { error: "invalid_subscription", message: "알림 구독 정보가 올바르지 않습니다." },
      400,
    );
  }

  const { error } = await auth.admin
    .from("web_push_subscriptions")
    .update({ disabled_at: new Date().toISOString() })
    .eq("user_id", auth.userId)
    .eq("endpoint", endpoint);
  if (error) {
    return commerceJson(
      { error: "push_remove_failed", message: "알림 구독을 해제하지 못했습니다." },
      503,
    );
  }
  return commerceJson({ ok: true });
}

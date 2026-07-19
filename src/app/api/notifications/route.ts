import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user
    .from("notifications")
    .select("*")
    .eq("member_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return commerceJson({ error: "notifications_unavailable" }, 503);
  return commerceJson({ notifications: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { notificationId?: string } | null;
  if (!body?.notificationId) return commerceJson({ error: "알림을 선택해 주세요." }, 400);
  const { error } = await auth.user
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", body.notificationId)
    .eq("member_id", auth.userId);
  if (error) return commerceJson({ error: "notification_update_failed" }, 503);
  return commerceJson({ read: true });
}

import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getOwnerRoleCanaryState } from "@/lib/ownerRoleCanary.server";
import {
  canViewNotification,
  getVisibleNotificationAudiences,
  normalizeNotificationRole,
  type NotificationRecord,
} from "@/lib/notifications/types";

async function resolveViewerRole(auth: Awaited<ReturnType<typeof authenticateCommerceRequest>>) {
  if (!auth.ok) return "member" as const;
  const [{ data: role, error }, canary] = await Promise.all([
    auth.admin
      .from("account_access_roles")
      .select("role_code")
      .eq("user_id", auth.userId)
      .maybeSingle(),
    getOwnerRoleCanaryState(auth.admin, auth.userId).catch(() => null),
  ]);
  if (error) throw error;
  return normalizeNotificationRole(canary?.active ? canary.roleCode : role?.role_code);
}

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const [viewerRole, result] = await Promise.all([
      resolveViewerRole(auth),
      auth.user
        .from("notifications")
        .select("id, member_id, audience_role, kind, title, body, href, read_at, created_at")
        .eq("member_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (result.error) return commerceJson({ error: "notifications_unavailable" }, 503);
    const notifications = ((result.data ?? []) as NotificationRecord[])
      .filter((item) => canViewNotification(viewerRole, item.audience_role));
    return commerceJson({ notifications, viewerRole });
  } catch {
    return commerceJson({ error: "notifications_unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { markAll?: boolean; notificationId?: string } | null;
  let viewerRole;
  try {
    viewerRole = await resolveViewerRole(auth);
  } catch {
    return commerceJson({ error: "notifications_unavailable" }, 503);
  }
  if (body?.markAll === true) {
    const { error } = await auth.user
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("member_id", auth.userId)
      .in("audience_role", [...getVisibleNotificationAudiences(viewerRole)])
      .is("read_at", null);
    if (error) return commerceJson({ error: "notification_update_failed" }, 503);
    return commerceJson({ read: true });
  }
  if (!body?.notificationId) return commerceJson({ error: "알림을 선택해 주세요." }, 400);
  const { data: notification, error: notificationError } = await auth.user
    .from("notifications")
    .select("audience_role")
    .eq("id", body.notificationId)
    .eq("member_id", auth.userId)
    .maybeSingle();
  if (notificationError) return commerceJson({ error: "notification_update_failed" }, 503);
  if (!notification || !canViewNotification(viewerRole, notification.audience_role)) {
    return commerceJson({ error: "notification_not_found" }, 404);
  }
  const { error } = await auth.user
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", body.notificationId)
    .eq("member_id", auth.userId);
  if (error) return commerceJson({ error: "notification_update_failed" }, 503);
  return commerceJson({ read: true });
}

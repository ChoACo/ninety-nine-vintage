import { commerceJson } from "@/lib/commerce/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";
import { dispatchPendingWebPushNotifications } from "@/lib/webPush/server";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!provided) {
    return commerceJson({ error: "unauthorized" }, 401);
  }

  try {
    const { admin } = createSupabaseServerClients();
    const { data: verified, error } = await admin.rpc(
      "verify_web_push_dispatch_secret",
      { p_secret: provided },
    );
    if (error || !verified) {
      return commerceJson({ error: "unauthorized" }, 401);
    }
    return commerceJson(await dispatchPendingWebPushNotifications());
  } catch {
    return commerceJson({ error: "push_dispatch_failed" }, 503);
  }
}

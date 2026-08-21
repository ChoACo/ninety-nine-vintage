import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user.from("operator_product_publication_preferences")
    .select("publication_mode,scheduled_hour_kst,updated_at")
    .eq("user_id", auth.userId).eq("store_id", auth.selectedStoreId).maybeSingle();
  if (error) return commerceJson({ error: "publication_preference_unavailable" }, 503);
  return commerceJson({ preference: data ? {
    publicationMode: data.publication_mode,
    scheduledHourKst: data.scheduled_hour_kst,
    updatedAt: data.updated_at,
  } : { publicationMode: "now", scheduledHourKst: 10, updatedAt: null } });
}

export async function PUT(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const hour = Number(body?.scheduledHourKst);
  if (!body || !["now", "scheduled"].includes(String(body.publicationMode))
    || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return commerceJson({ error: "invalid_publication_preference" }, 400);
  }
  const { data, error } = await auth.user.rpc("set_operator_product_publication_preference", {
    p_store_id: auth.selectedStoreId,
    p_publication_mode: String(body.publicationMode),
    p_scheduled_hour_kst: hour,
  });
  if (error) return commerceJson({ error: error.message || "publication_preference_failed" }, error.code === "42501" ? 403 : 409);
  return commerceJson({ preference: data });
}

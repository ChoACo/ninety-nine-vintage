import { authenticateOwnerAccessRequest, ownerAccessErrorResponse, ownerAccessJsonResponse, readSmallJsonBody } from "@/lib/ownerAccess/server";

const allowedStatuses = new Set(["operational", "maintenance", "preparing"]);

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const { data, error } = await access.admin.from("site_status").select("status, message, updated_at, updated_by").eq("singleton", true).maybeSingle();
    if (error) return ownerAccessJsonResponse({ error: "site_status_unavailable", dbConnected: false }, 503);
    return ownerAccessJsonResponse({ status: data?.status ?? "operational", message: data?.message ?? "", updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null, dbConnected: true });
  } catch (error) { return ownerAccessErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const status = typeof body.status === "string" ? body.status.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    if (!allowedStatuses.has(status)) return ownerAccessJsonResponse({ error: "invalid_status" }, 400);
    const { data, error } = await access.admin.from("site_status").upsert({ singleton: true, status, message, updated_by: access.userId, updated_at: new Date().toISOString() }, { onConflict: "singleton" }).select("status, message, updated_at, updated_by").single();
    if (error) return ownerAccessJsonResponse({ error: "site_status_unavailable", dbConnected: false }, 503);
    return ownerAccessJsonResponse({ status: data.status, message: data.message, updatedAt: data.updated_at, updatedBy: data.updated_by, dbConnected: true });
  } catch (error) { return ownerAccessErrorResponse(error); }
}

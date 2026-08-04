import { getStorageUsageSummary } from "@/lib/multicloud/storageUsage";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);

  try {
    const summary = await getStorageUsageSummary();
    return commerceJson(summary);
  } catch {
    return commerceJson({ error: "storage_usage_unavailable" }, 503);
  }
}
import { getStorageUsageSummary } from "@/lib/multicloud/storageUsage";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden", message: "소유자 권한이 필요합니다." }, 403);

  try {
    const summary = await getStorageUsageSummary();
    return commerceJson(summary);
  } catch {
    return commerceJson({ error: "storage_credentials_unavailable", message: "스토리지 연동 인증 키를 확인해 주세요" }, 503);
  }
}
import { getStorageUsageSummary } from "@/lib/multicloud/storageUsage";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden", message: "소유자 권한이 필요합니다." }, 403);

  try {
    const summary = await getStorageUsageSummary();
    return commerceJson(summary);
  } catch (error) {
    console.error("[owner-storage-usage] R2 listing failed", {
      code: error && typeof error === "object" && "Code" in error ? error.Code : undefined,
      httpStatus: error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode
        : undefined,
      message: error instanceof Error ? error.message : "unknown_error",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return commerceJson({ error: "storage_credentials_unavailable", message: "스토리지 연동 인증 키를 확인해 주세요" }, 503);
  }
}

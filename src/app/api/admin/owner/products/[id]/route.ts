import { PATCH as updateManagedProduct } from "@/app/api/admin/operator/products/[id]/route";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  return updateManagedProduct(request, context);
}

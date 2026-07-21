import { POST as createManagedProducts } from "@/app/api/admin/operator/products/bulk/route";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  return createManagedProducts(request);
}

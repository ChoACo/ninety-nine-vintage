import {
  GET as getManagedProducts,
  POST as createManagedProduct,
} from "@/app/api/admin/operator/products/route";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

async function authorizeOwner(request: Request, mutation = false) {
  const auth = await authenticateStaffRequest(request, mutation);
  if (!auth.ok) return auth.response;
  return auth.roleCode === "owner" ? null : commerceJson({ error: "forbidden" }, 403);
}

export async function GET(request: Request) {
  const denied = await authorizeOwner(request);
  return denied ?? getManagedProducts(request);
}

export async function POST(request: Request) {
  const denied = await authorizeOwner(request, true);
  return denied ?? createManagedProduct(request);
}

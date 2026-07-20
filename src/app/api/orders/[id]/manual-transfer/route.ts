import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { syncManualTransferSettings } from "@/lib/manualTransferConfig";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  try {
    await syncManualTransferSettings(auth.admin);
  } catch {
    return commerceJson({ error: "운영자가 입금 계좌를 설정한 후 주문할 수 있습니다." }, 503);
  }
  const { id } = await params;
  const { data: transfer, error } = await auth.user.rpc("create_commerce_order_transfer", { p_order_id: id });
  if (error) {
    const status = ["P0002", "55000"].includes(error.code ?? "") ? 409 : 503;
    return commerceJson({ error: error.message || "입금 안내를 만들지 못했습니다." }, status);
  }
  return commerceJson({ transfer }, 201);
}

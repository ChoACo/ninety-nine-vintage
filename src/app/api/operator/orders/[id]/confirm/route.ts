import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  await params;
  return commerceJson({
    error: "manual_transfer_ledger_required",
    message: "입금자명과 실제 입금액을 원장에 기록해 주세요.",
  }, 409);
}

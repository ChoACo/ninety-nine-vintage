import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: order, error: orderError } = await auth.admin
    .from("commerce_orders")
    .select("id, member_id, total, status")
    .eq("id", id)
    .eq("member_id", auth.userId)
    .maybeSingle();
  if (orderError) return commerceJson({ error: "order_unavailable" }, 503);
  if (!order) return commerceJson({ error: "order_not_found" }, 404);
  if (order.status !== "awaiting_payment") return commerceJson({ error: "이미 결제 처리된 주문입니다." }, 409);

  const { data: existing, error: existingError } = await auth.admin
    .from("commerce_order_transfers")
    .select("*")
    .eq("order_id", id)
    .maybeSingle();
  if (existingError) return commerceJson({ error: "transfer_unavailable" }, 503);
  if (existing) return commerceJson({ transfer: existing }, 200);

  const { data: settings, error: settingsError } = await auth.user.rpc("get_manual_transfer_settings");
  if (settingsError) return commerceJson({ error: "manual_transfer_unavailable" }, 503);
  const setting = Array.isArray(settings) ? settings[0] : settings;
  if (!setting?.configured) return commerceJson({ error: "manual_transfer_unavailable" }, 503);

  const { data: transfer, error } = await auth.admin
    .from("commerce_order_transfers")
    .insert({
      order_id: id,
      member_id: auth.userId,
      expected_amount: order.total,
      bank_name_snapshot: setting.bank_name,
      account_number_snapshot: setting.account_number,
    })
    .select("*")
    .single();
  if (error) return commerceJson({ error: "transfer_unavailable" }, 503);
  return commerceJson({ transfer }, 201);
}

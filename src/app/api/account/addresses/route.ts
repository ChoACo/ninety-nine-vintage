import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request); if (!auth.ok) return auth.response;
  const { data, error } = await auth.user.from("shipping_addresses").select("*").order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  if (error) return commerceJson({ error: "address_unavailable" }, 503);
  return commerceJson({ addresses: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true); if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { label?: string; recipientName?: string; phone?: string; postalCode?: string; address?: string; isDefault?: boolean } | null;
  if (!body?.label?.trim() || !body.recipientName?.trim() || !body.phone?.trim() || !body.address?.trim()) return commerceJson({ error: "배송지 정보를 모두 입력해 주세요." }, 400);
  if (body.isDefault) await auth.user.from("shipping_addresses").update({ is_default: false }).eq("member_id", auth.userId);
  const { data, error } = await auth.user.from("shipping_addresses").insert({ member_id: auth.userId, label: body.label.trim(), recipient_name: body.recipientName.trim(), phone: body.phone.trim(), postal_code: body.postalCode?.trim() || null, address: body.address.trim(), is_default: Boolean(body.isDefault) }).select("*").single();
  if (error) return commerceJson({ error: "address_save_failed" }, 409);
  return commerceJson({ address: data }, 201);
}

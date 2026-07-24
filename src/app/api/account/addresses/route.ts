import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request); if (!auth.ok) return auth.response;
  const { data, error } = await auth.user.from("shipping_addresses").select("*").order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  if (error) return commerceJson({ error: "address_unavailable" }, 503);
  return commerceJson({ addresses: data ?? [] });
}

async function saveAddress(request: Request, addressId: string | null) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as {
    address?: string;
    isDefault?: boolean;
    label?: string;
    phone?: string;
    postalCode?: string;
    recipientName?: string;
  } | null;
  if (addressId !== null && !UUID_PATTERN.test(addressId)) {
    return commerceJson({ error: "수정할 배송지를 확인해 주세요." }, 422);
  }
  const postalCode = body?.postalCode?.trim() ?? "";
  if (
    !body?.label?.trim() ||
    !body.recipientName?.trim() ||
    !body.phone?.trim() ||
    !body.address?.trim() ||
    (postalCode.length > 0 && !/^[0-9]{5}$/u.test(postalCode))
  ) {
    return commerceJson(
      { error: "배송지 정보와 5자리 우편번호를 확인해 주세요." },
      422,
    );
  }
  const { data, error } = await auth.user
    .rpc("upsert_my_shipping_address", {
      p_id: addressId,
      p_label: body.label.trim(),
      p_recipient_name: body.recipientName.trim(),
      p_phone: body.phone.trim(),
      p_postal_code: postalCode || null,
      p_address: body.address.trim(),
      p_is_default: Boolean(body.isDefault),
    })
    .single();
  if (error || !data) {
    return commerceJson(
      { error: error?.message ?? "배송지를 저장하지 못했습니다." },
      409,
    );
  }
  return commerceJson({ address: data }, addressId ? 200 : 201);
}

export async function POST(request: Request) {
  return saveAddress(request, null);
}

export async function PATCH(request: Request) {
  const body = await request.clone().json().catch(() => null) as { id?: string } | null;
  return saveAddress(request, body?.id?.trim() ?? "");
}

export async function DELETE(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { id?: string } | null;
  const addressId = body?.id?.trim() ?? "";
  if (!UUID_PATTERN.test(addressId)) {
    return commerceJson({ error: "삭제할 배송지를 확인해 주세요." }, 422);
  }
  const { error } = await auth.user.rpc("delete_my_shipping_address", {
    p_address_id: addressId,
  });
  if (error) {
    return commerceJson(
      { error: error.message ?? "배송지를 삭제하지 못했습니다." },
      error.code === "P0002" ? 404 : 409,
    );
  }
  return commerceJson({ deletedAddressId: addressId });
}

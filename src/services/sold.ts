import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function fetchSoldArchive() {
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier.rpc("get_public_sold_auctions", { p_limit: 100 });
  if (error) throw new Error("판매 완료 아카이브를 불러오지 못했습니다.");
  return (data ?? []).map((product) => ({
    ...product,
    image_urls: (product.image_urls ?? []).map((image) => getCatalogImageUrl(image)),
  }));
}

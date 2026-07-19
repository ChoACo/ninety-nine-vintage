import "server-only";

import { createSupabaseServerClients } from "@/lib/supabase/server";

export async function fetchSoldArchive() {
  const { verifier } = createSupabaseServerClients();
  const { data, error } = await verifier.rpc("get_public_sold_auctions", { p_limit: 100 });
  if (error) throw new Error("판매 완료 아카이브를 불러오지 못했습니다.");
  return data ?? [];
}

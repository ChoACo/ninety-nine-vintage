import { commerceJson } from "@/lib/commerce/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";

const fallbackMessage = "현재 사이트 상태를 확인할 수 없습니다.";

export async function GET() {
  try {
    const { admin } = createSupabaseServerClients();
    const { data, error } = await admin.from("site_status").select("status, message, updated_at").eq("singleton", true).maybeSingle();
    if (error) return commerceJson({ status: "operational", message: fallbackMessage, dbConnected: false });
    return commerceJson({ status: data?.status ?? "operational", message: data?.message ?? "", updatedAt: data?.updated_at ?? null, dbConnected: true });
  } catch {
    return commerceJson({ status: "operational", message: fallbackMessage, dbConnected: false });
  }
}

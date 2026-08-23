import { parsePlatformConfig } from "@/lib/platform/config";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await createSupabasePublicClient()
      .from("platform_config")
      .select(
        "global_delivery_fee,storage_duration_days,home_sections,banners,policy_markdown,version",
      )
      .eq("config_key", "default")
      .single();
    if (error || !data) {
      return Response.json(
        { error: "platform_config_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(parsePlatformConfig(data), {
      headers: { "Cache-Control": "no-store", Vary: "Accept-Encoding" },
    });
  } catch {
    return Response.json(
      { error: "platform_config_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

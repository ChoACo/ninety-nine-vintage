import "server-only";

import {
  DEFAULT_PLATFORM_CONFIG,
  parsePlatformConfig,
  type PlatformConfig,
} from "@/lib/platform/config";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export async function fetchPlatformConfig(): Promise<PlatformConfig> {
  try {
    const { data, error } = await createSupabasePublicClient()
      .from("platform_config")
      .select(
        "global_delivery_fee,storage_duration_days,home_sections,banners,policy_markdown,version",
      )
      .eq("config_key", "default")
      .single();
    return error || !data ? DEFAULT_PLATFORM_CONFIG : parsePlatformConfig(data);
  } catch {
    return DEFAULT_PLATFORM_CONFIG;
  }
}

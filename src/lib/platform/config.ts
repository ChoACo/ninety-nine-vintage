import type { Json } from "@/lib/supabase/database.types";

export const DEFAULT_PLATFORM_CONFIG = {
  banners: [] as PlatformBanner[],
  globalDeliveryFee: 4_000,
  homeSections: {
    archiveShop: true,
    centerMall: true,
    featuredAuction: true,
  },
  policyMarkdown: "",
  storageDurationDays: 14,
  version: 0,
} satisfies PlatformConfig;

export interface PlatformBanner {
  enabled: boolean;
  id: string;
  imageUrl: string;
  title: string;
}

export interface PlatformConfig {
  banners: PlatformBanner[];
  globalDeliveryFee: number;
  homeSections: Record<string, boolean>;
  policyMarkdown: string;
  storageDurationDays: number;
  version: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseSections(value: Json): Record<string, boolean> {
  if (!record(value)) return DEFAULT_PLATFORM_CONFIG.homeSections;
  return {
    ...DEFAULT_PLATFORM_CONFIG.homeSections,
    ...Object.fromEntries(Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    )),
  };
}

function parseBanners(value: Json): PlatformBanner[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.imageUrl !== "string" ||
      typeof item.enabled !== "boolean"
    ) {
      return [];
    }
    return [{
      enabled: item.enabled,
      id: item.id,
      imageUrl: item.imageUrl,
      title: item.title,
    }];
  });
}

export function parsePlatformConfig(value: unknown): PlatformConfig {
  if (!record(value)) return DEFAULT_PLATFORM_CONFIG;
  const globalDeliveryFee = Number(
    value.globalDeliveryFee ?? value.global_delivery_fee,
  );
  const storageDurationDays = Number(
    value.storageDurationDays ?? value.storage_duration_days,
  );
  const version = Number(value.version);
  return {
    banners: parseBanners((value.banners ?? []) as Json),
    globalDeliveryFee:
      Number.isSafeInteger(globalDeliveryFee) && globalDeliveryFee >= 0
        ? globalDeliveryFee
        : DEFAULT_PLATFORM_CONFIG.globalDeliveryFee,
    homeSections: parseSections(
      (value.homeSections ?? value.home_sections ?? {}) as Json,
    ),
    policyMarkdown:
      typeof (value.policyMarkdown ?? value.policy_markdown) === "string"
        ? String(value.policyMarkdown ?? value.policy_markdown)
        : "",
    storageDurationDays:
      Number.isSafeInteger(storageDurationDays) && storageDurationDays > 0
        ? storageDurationDays
        : DEFAULT_PLATFORM_CONFIG.storageDurationDays,
    version: Number.isSafeInteger(version) && version >= 0 ? version : 0,
  };
}

"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PLATFORM_CONFIG,
  parsePlatformConfig,
  type PlatformConfig,
} from "@/lib/platform/config";
import {
  clientErrorFromResponse,
  reportClientError,
} from "@/lib/clientErrors";

let cachedConfig: PlatformConfig | null = null;
let pendingConfig: Promise<PlatformConfig> | null = null;

async function loadPlatformConfig() {
  if (cachedConfig) return cachedConfig;
  pendingConfig ??= fetch("/api/platform-config", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw await clientErrorFromResponse(
          response,
          "플랫폼 설정을 불러오지 못했습니다.",
        );
      }
      return parsePlatformConfig(await response.json());
    })
    .then((config) => {
      cachedConfig = config;
      return config;
    })
    .finally(() => {
      pendingConfig = null;
    });
  return pendingConfig;
}

export function invalidatePlatformConfig() {
  cachedConfig = null;
}

export function usePlatformConfig() {
  const [config, setConfig] = useState(
    () => cachedConfig ?? DEFAULT_PLATFORM_CONFIG,
  );

  useEffect(() => {
    let active = true;
    void loadPlatformConfig()
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch((error: unknown) => {
        reportClientError(error, {
          dedupeKey: "platform-config-load",
          fallback: "플랫폼 설정을 불러오지 못했습니다. 기본 설정을 사용합니다.",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return config;
}

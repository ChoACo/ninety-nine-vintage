"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PLATFORM_CONFIG,
  parsePlatformConfig,
  type PlatformConfig,
} from "@/lib/platform/config";

let cachedConfig: PlatformConfig | null = null;
let pendingConfig: Promise<PlatformConfig> | null = null;

async function loadPlatformConfig() {
  if (cachedConfig) return cachedConfig;
  pendingConfig ??= fetch("/api/platform-config", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("platform_config_unavailable");
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
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return config;
}

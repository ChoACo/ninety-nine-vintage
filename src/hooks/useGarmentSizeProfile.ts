"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  isMeasurementInRange,
  type SavedGarmentProfile,
} from "@/utils/productMeasurements";

const STORAGE_PREFIX = "nnv:garment-profile:v1:";
const GUEST_STORAGE_KEY = `${STORAGE_PREFIX}guest-session`;
const CHANGE_EVENT = "nnv:garment-profile-changed";
const STORAGE_UNAVAILABLE = "__NNV_STORAGE_UNAVAILABLE__";

function scopedStorage(userId?: string | null): Storage {
  return userId ? window.localStorage : window.sessionStorage;
}

function scopedStorageKey(userId?: string | null): string {
  return userId ? `${STORAGE_PREFIX}${userId}` : GUEST_STORAGE_KEY;
}

function readStoredSnapshot(userId?: string | null): string | null {
  try {
    return scopedStorage(userId).getItem(scopedStorageKey(userId));
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

function writeStoredSnapshot(userId: string | null | undefined, value: string): boolean {
  try {
    scopedStorage(userId).setItem(scopedStorageKey(userId), value);
    return true;
  } catch {
    return false;
  }
}

function removeStoredSnapshot(userId?: string | null): boolean {
  try {
    scopedStorage(userId).removeItem(scopedStorageKey(userId));
    return true;
  } catch {
    return false;
  }
}

function normalizeProfile(value: unknown): SavedGarmentProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<SavedGarmentProfile>;
  if (
    !isMeasurementInRange("chestWidthCm", Number(candidate.chestWidthCm)) ||
    !isMeasurementInRange("totalLengthCm", Number(candidate.totalLengthCm)) ||
    !isMeasurementInRange("shoulderWidthCm", Number(candidate.shoulderWidthCm)) ||
    (candidate.sleeveLengthCm !== undefined &&
      !isMeasurementInRange("sleeveLengthCm", Number(candidate.sleeveLengthCm))) ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt))
  ) {
    return null;
  }

  return {
    chestWidthCm: Number(candidate.chestWidthCm),
    totalLengthCm: Number(candidate.totalLengthCm),
    shoulderWidthCm: Number(candidate.shoulderWidthCm),
    sleeveLengthCm: candidate.sleeveLengthCm === undefined
      ? undefined
      : Number(candidate.sleeveLengthCm),
    updatedAt: candidate.updatedAt,
  };
}

export interface GarmentSizeProfileState {
  hydrated: boolean;
  persistsOnDevice: boolean;
  profile: SavedGarmentProfile | null;
  remove: () => void;
  save: (profile: Omit<SavedGarmentProfile, "updatedAt">) => void;
}

export function useGarmentSizeProfile(userId?: string | null): GarmentSizeProfileState {
  const scope = scopedStorageKey(userId);
  const [memoryFallback, setMemoryFallback] = useState<{
    profile: SavedGarmentProfile | null;
    scope: string;
  }>({ profile: null, scope });

  const subscribe = useCallback((onStoreChange: () => void) => {
    const key = scopedStorageKey(userId);
    const handleChange = (event: Event) => {
      const custom = event as CustomEvent<{ userId?: string }>;
      if ((custom.detail?.userId ?? null) === (userId ?? null)) onStoreChange();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) onStoreChange();
    };
    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [userId]);

  const getSnapshot = useCallback(() => readStoredSnapshot(userId), [userId]);
  const getServerSnapshot = useCallback(() => undefined, []);
  const serializedProfile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const storedProfile = useMemo(() => {
    if (!serializedProfile || serializedProfile === STORAGE_UNAVAILABLE) return null;
    try {
      return normalizeProfile(JSON.parse(serializedProfile));
    } catch {
      return null;
    }
  }, [serializedProfile]);
  const storageUnavailable = serializedProfile === STORAGE_UNAVAILABLE;
  const fallbackProfile = memoryFallback.scope === scope ? memoryFallback.profile : null;
  const profile = storageUnavailable ? fallbackProfile : storedProfile;

  const save = useCallback((next: Omit<SavedGarmentProfile, "updatedAt">) => {
    const normalized = normalizeProfile({ ...next, updatedAt: new Date().toISOString() });
    if (!normalized) throw new RangeError("옷 실측값의 입력 범위를 확인해 주세요.");
    if (writeStoredSnapshot(userId, JSON.stringify(normalized))) {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId } }));
    } else {
      setMemoryFallback({ profile: normalized, scope });
    }
  }, [scope, userId]);

  const remove = useCallback(() => {
    if (removeStoredSnapshot(userId)) {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId } }));
    } else {
      setMemoryFallback({ profile: null, scope });
    }
  }, [scope, userId]);

  return {
    hydrated: serializedProfile !== undefined,
    persistsOnDevice: Boolean(userId) && !storageUnavailable,
    profile,
    remove,
    save,
  };
}

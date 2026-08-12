export const OWNER_MEMBER_ACCESS_STORAGE_KEY =
  "ninety-nine:owner-member-access:v1";

export const OWNER_RETURN_CONFIRMATION = "소유자 복귀";

interface OwnerMemberAccessMarker {
  startedAt: string;
  version: 1;
}

export function storeOwnerMemberAccessMarker() {
  const marker: OwnerMemberAccessMarker = {
    startedAt: new Date().toISOString(),
    version: 1,
  };
  try {
    window.sessionStorage.setItem(
      OWNER_MEMBER_ACCESS_STORAGE_KEY,
      JSON.stringify(marker),
    );
    return true;
  } catch {
    return false;
  }
}

export function hasOwnerMemberAccessMarker() {
  try {
    const raw = window.sessionStorage.getItem(
      OWNER_MEMBER_ACCESS_STORAGE_KEY,
    );
    if (!raw) return false;
    const marker = JSON.parse(raw) as Partial<OwnerMemberAccessMarker>;
    return marker.version === 1 && typeof marker.startedAt === "string";
  } catch {
    return false;
  }
}

export function clearOwnerMemberAccessMarker() {
  try {
    window.sessionStorage.removeItem(OWNER_MEMBER_ACCESS_STORAGE_KEY);
  } catch {
    // The marker is only a UI aid; authorization never depends on storage.
  }
}

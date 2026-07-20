export type CommerceOwnerMode =
  | "unknown"
  | "guest"
  | "member-loading"
  | "member-ready";

export function shouldPersistCommerceLocally(
  ownerMode: CommerceOwnerMode,
): boolean {
  return ownerMode === "guest";
}

export function resolveVisibleCommerceCount(input: {
  count: number;
  sessionLoading: boolean;
  sessionUserId: string | null;
  ownerMode: CommerceOwnerMode;
  ownerUserId: string | null;
}): number | null {
  if (input.sessionLoading) return null;

  if (input.sessionUserId === null) {
    return input.ownerMode === "guest" && input.ownerUserId === null
      ? input.count
      : null;
  }

  return input.ownerMode === "member-ready" &&
    input.ownerUserId === input.sessionUserId
    ? input.count
    : null;
}

interface CommerceSessionIdentity {
  access_token: string;
  user: { id: string };
}

export function canCommitCommerceSnapshot(input: {
  generation: number;
  currentGeneration: number;
  expectedUserId: string;
  expectedAccessToken: string;
  currentSession: CommerceSessionIdentity | null;
}): boolean {
  return (
    input.generation === input.currentGeneration &&
    input.currentSession?.user.id === input.expectedUserId &&
    input.currentSession.access_token === input.expectedAccessToken
  );
}
